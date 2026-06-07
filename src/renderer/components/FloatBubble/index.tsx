import { useEffect, useState, useRef } from 'react';
import { useAudioCapture } from '@/hooks/useAudioCapture';
import { useVoiceflowStore } from '@/store';

declare global {
  interface Window {
    voiceflow: any;
  }
}

/** Electron accelerator → 用户友好显示 */
function accelToDisplay(s: string): string {
  if (!s) return '';
  return s
    .replace(/CommandOrControl/g, 'Ctrl')
    .replace(/Control/g, 'Ctrl')
    .replace(/Command/g, '⊞')
    .replace(/Escape/g, 'Esc')
    .replace(/Plus/g, '+')
    .replace(/\+/g, '+');
}

type BubbleState = 'idle' | 'recording' | 'transcribing' | 'processing' | 'preview';

export function FloatBubble() {
  // ───── 状态：朴素 React state，无任何动画库 ─────
  const [state, setState] = useState<BubbleState>('idle');
  const [text, setText] = useState('');          // 识别原文
  const [polished, setPolished] = useState('');   // AI 优化后
  const [partial, setPartial] = useState('');    // 实时 partial
  const [error, setError] = useState('');        // 错误消息
  const [injectResult, setInjectResult] = useState<any>(null);
  const [hotkey, setHotkey] = useState('Ctrl+Alt+Z');
  const [hotkeyConfig, setHotkeyConfig] = useState<any>(null);
  const [label, setLabel] = useState('');
  const [seconds, setSeconds] = useState(0);

  // 订阅麦克风 RMS（useAudioCapture 在 worklet 里 setMicVolume(rms)）
  const micVolume = useVoiceflowStore((s) => s.micVolume);

  // ───── 加载 hotkey 配置 ─────
  // 录音时启动麦克风采集 → 通过 IPC 把 PCM 帧发到主进程 → 喂给腾讯 ASR
  // 关键 hook：少了它就没有音频帧，腾讯会 15s 后返回 4008（"客户端超过15秒未发送音频数据"）
  useAudioCapture(state === 'recording');

  useEffect(() => {
    window.voiceflow.getConfig().then((c: any) => {
      if (c?.hotkeys) {
        setHotkeyConfig(c.hotkeys);
        if (c.hotkeys.pushToTalk) setHotkey(accelToDisplay(c.hotkeys.pushToTalk));
      }
    });
  }, []);

  // ───── 录音计时：仅依赖 state ─────
  const startedAtRef = useRef<number>(0);
  useEffect(() => {
    if (state !== 'recording') {
      startedAtRef.current = 0;
      setSeconds(0);
      return;
    }
    startedAtRef.current = Date.now();
    const timer = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 200);
    return () => clearInterval(timer);
  }, [state]);

  // ───── IPC 订阅 ─────
  useEffect(() => {
    const subs: Array<() => void> = [];

    subs.push(
      window.voiceflow.on('state:change', (payload: any) => {
        const v = (typeof payload === 'string' ? payload : payload?.state) as BubbleState;
        if (!v) return;
        setState(v);
        if (typeof payload === 'object' && payload.label) setLabel(payload.label);
        if (v === 'idle') {
          setText(''); setPolished(''); setError(''); setInjectResult(null); setPartial('');
        }
        if (v === 'recording') {
          setText(''); setPolished(''); setError(''); setInjectResult(null); setPartial('');
        }
      })
    );

    subs.push(
      window.voiceflow.on('asr:partial', (r: any) => setPartial(r?.text ?? ''))
    );

    subs.push(
      window.voiceflow.on('asr:final', (r: any) => setText(r?.text ?? ''))
    );

    subs.push(
      window.voiceflow.on('asr:error', (e: any) => {
        setError(e?.message ?? '识别错误');
        setState('idle');
        setTimeout(() => window.voiceflow.hideFloat(), 2000);
      })
    );

    subs.push(
      window.voiceflow.on('llm:start', (r: any) => {
        // 关键：preview 状态的原文来自 llm:start
        setText(r?.original ?? '');
        setPolished('');
      })
    );

    subs.push(
      window.voiceflow.on('llm:chunk', (r: any) => setPolished(r?.text ?? ''))
    );

    subs.push(
      window.voiceflow.on('llm:done', (r: any) => setPolished(r?.text ?? ''))
    );

    subs.push(
      window.voiceflow.on('inject:result', (r: any) => setInjectResult(r))
    );

    // 设置里改了快捷键 → 浮窗的 kbd 标签立即更新
    subs.push(
      window.voiceflow.on('config:updated', (c: any) => {
        if (c?.hotkeys) {
          setHotkeyConfig(c.hotkeys);
          if (c.hotkeys.pushToTalk) setHotkey(accelToDisplay(c.hotkeys.pushToTalk));
        }
      })
    );

    return () => subs.forEach((u) => u());
  }, []);

  // ───── 动态调整窗口大小（直接用 DOM 测量） ─────
  useEffect(() => {
    if (state !== 'preview' && state !== 'processing') {
      window.voiceflow.send('float:resize', { wide: false });
      return;
    }
    // 等一帧让 preview 渲染完成
    const t = setTimeout(() => {
      const el = document.getElementById('vf-preview-root');
      if (el) {
        const h = el.scrollHeight + 16;
        window.voiceflow.send('float:resize', { wide: true, previewHeight: Math.max(240, Math.min(500, h)) });
      } else {
        window.voiceflow.send('float:resize', { wide: true, previewHeight: 240 });
      }
    }, 50);
    return () => clearTimeout(t);
  }, [state, text, polished]);

  // ───── preview 状态本地快捷键 ─────
  // 解决 Trae/VSCode 等 IDE 的全局快捷键抢占问题：
  //   - Alt+1..5 / Ctrl+Alt+1 / Shift+2 走 globalShortcut.register 会被 IDE 静默吃掉
  //   - 主进程进入 preview 时已 focus() 浮窗 → 这里用 window keydown 兜底
  //   - 仅在 isPreview 启用，idle/recording 时不占快捷键
  const isPreview = state === 'preview' || state === 'processing';
  useEffect(() => {
    if (!isPreview) return;

    const handler = (e: KeyboardEvent) => {
      // 文本框输入中不拦截
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      const isAlt = e.altKey;
      const isCtrl = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;

      // Alt+1..5 → 触发对应 slot 的 AI 优化
      if (isAlt && !isCtrl && !isShift && !e.repeat) {
        const k = e.key;
        if (k >= '1' && k <= '5') {
          e.preventDefault();
          e.stopPropagation();
          if (text) window.voiceflow.requestPolish(text, parseInt(k, 10) - 1);
          return;
        }
      }

      // Ctrl+Alt+1 → 注入原文
      if (isCtrl && isAlt && !isShift && (e.key === '1' || e.key === '!')) {
        e.preventDefault();
        e.stopPropagation();
        if (text) window.voiceflow.confirmInject(text);
        return;
      }

      // Shift+2 (即 "@") → 注入优化（仅在已有 polished 时）
      if (isShift && !isAlt && !isCtrl && (e.key === '@' || (e.key === '2' && isShift))) {
        e.preventDefault();
        e.stopPropagation();
        if (polished) window.voiceflow.confirmInject(polished);
        return;
      }

      // Esc → 丢弃（与全局 cancel 一致）
      if (e.key === 'Escape' && !isAlt && !isCtrl && !isShift) {
        e.preventDefault();
        e.stopPropagation();
        window.voiceflow.discardPreview();
        return;
      }
    };

    // capture: true → 在 React 之前先看到 keydown
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true } as any);
  }, [isPreview, text, polished]);

  return (
    <div
      onClick={isPreview ? undefined : handleBubbleClick}
      style={{
        width: '100%',
        height: '100%',
        background: 'transparent',
        display: 'flex',
        alignItems: isPreview ? 'stretch' : 'center',
        justifyContent: 'center',
        padding: 0,
        boxSizing: 'border-box',
        cursor: isPreview ? 'default' : 'pointer',
      }}
    >
      {isPreview ? (
        <PreviewPanel
          state={state}
          text={text}
          polished={polished}
          injectResult={injectResult}
          label={label}
          hotkeyConfig={hotkeyConfig}
        />
      ) : (
        <Bubble
          state={state}
          partial={partial}
          error={error}
          hotkey={hotkey}
          label={label}
          seconds={seconds}
          micVolume={micVolume}
        />
      )}
    </div>
  );

  async function handleBubbleClick() {
    if (state === 'recording' || state === 'transcribing') {
      window.voiceflow.stopRecording();
      return;
    }
    if (state === 'processing') return;
    // idle：先检查腾讯云配置
    const config = await window.voiceflow.getConfig();
    const tencent = config?.tencentASR;
    if (!tencent?.appId || !tencent?.secretId || !tencent?.secretKey) {
      window.voiceflow.openSettings();
      return;
    }
    window.voiceflow.startRecording(false);
  }
}

// ===========================================================================
// Bubble：录音/转写/idle/error 时的圆角胶囊
// ===========================================================================
function Bubble(props: {
  state: BubbleState;
  partial: string;
  error: string;
  hotkey: string;
  label: string;
  seconds: number;
  micVolume: number;
}) {
  const { state, partial, error, hotkey, label, seconds, micVolume } = props;

  // 通用 wrapper
  const wrap: React.CSSProperties = {
    width: 500,
    height: 120,
    background: 'rgba(255, 255, 255, 0.92)',
    border: '1px solid rgba(255, 255, 255, 0.6)',
    borderRadius: 60,
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 24px',
    boxSizing: 'border-box',
    color: '#1a1d29',
    userSelect: 'none',
    position: 'relative',
    overflow: 'hidden',
  };

  if (error) {
    return (
      <div style={wrap}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#dc2626' }}>{error}</div>
      </div>
    );
  }

  if (state === 'recording') {
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    // 音量 → 高度：4 (静默) ~ 32 (大声)，clamp 0~1 防爆
    const v = Math.max(0, Math.min(1, micVolume));
    return (
      <div style={wrap}>
        {/* 顶部 ASR 引擎标签 */}
        {label && (
          <div
            style={{
              position: 'absolute',
              top: 8,
              left: 16,
              fontSize: 9,
              color: '#6b7280',
              fontFamily: 'monospace',
            }}
          >
            {label}
          </div>
        )}
        {/* 右上小红点：录音中标识 */}
        <div
          style={{
            position: 'absolute',
            top: 10,
            right: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 9,
            color: '#dc2626',
            fontWeight: 600,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#dc2626',
              animation: 'dotPulse 1.2s ease-in-out infinite',
              display: 'inline-block',
            }}
          />
          <span>REC</span>
        </div>
        {/* 中央：波形 + 文字 + 计时（高度由 micVolume 决定，静默时几乎贴底） */}
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'end', gap: 4, height: 32 }}>
            {[0, 1, 2, 3, 4].map((i) => {
              // 每根 bar 有略微不同的灵敏度（中间最高），让波形有点"形"
              const sensitivity = [0.7, 0.85, 1.0, 0.85, 0.7][i];
              const h = 4 + v * 28 * sensitivity;
              return (
                <div
                  key={i}
                  style={{
                    width: 4,
                    height: `${h}px`,
                    background: 'linear-gradient(180deg, #5b8def, #a78bfa)',
                    borderRadius: 2,
                    transition: 'height 60ms ease-out',
                  }}
                />
              );
            })}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>正在聆听…</div>
          <div style={{ fontSize: 10, color: '#6b7280' }}>说完自动停止</div>
          <div style={{ fontSize: 14, fontFamily: 'monospace', color: '#5b8def', fontWeight: 600 }}>
            {mm}:{ss}
          </div>
        </div>
        {/* 底部 partial 文本 */}
        {partial && (
          <div
            style={{
              position: 'absolute',
              bottom: 8,
              left: '50%',
              transform: 'translateX(-50%)',
              maxWidth: 280,
              padding: '4px 12px',
              background: 'rgba(255, 255, 255, 0.85)',
              borderRadius: 12,
              fontSize: 11,
              color: '#374151',
              textAlign: 'center',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {partial}
          </div>
        )}
      </div>
    );
  }

  if (state === 'transcribing' || state === 'processing') {
    return (
      <div style={wrap}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: state === 'processing'
              ? 'linear-gradient(135deg, rgba(167, 139, 250, 0.18), rgba(91, 141, 239, 0.18))'
              : 'linear-gradient(135deg, rgba(91, 141, 239, 0.12), rgba(167, 139, 250, 0.12))',
            pointerEvents: 'none',
          }}
        />
        {label && (
          <div style={{ position: 'absolute', top: 8, left: 16, fontSize: 9, color: '#6b7280', fontFamily: 'monospace' }}>
            {label}
          </div>
        )}
        {/* Spinner */}
        <div
          style={{
            width: 36,
            height: 36,
            border: '3px solid rgba(91, 141, 239, 0.2)',
            borderTop: '3px solid #5b8def',
            borderRadius: '50%',
            animation: 'spin 1.2s linear infinite',
          }}
        />
        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 8 }}>
          {state === 'processing' ? 'AI 优化中…' : '识别中…'}
        </div>
        <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>请稍候</div>
      </div>
    );
  }

  // idle
  return (
    <div style={wrap}>
      {label && (
        <div style={{ position: 'absolute', top: 8, left: 16, fontSize: 9, color: '#6b7280', fontFamily: 'monospace' }}>
          {label}
        </div>
      )}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #5b8def, #a78bfa)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 6,
        }}
      >
        {/* mic icon */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>按 {hotkey} 说话</div>
      <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>也可点击浮窗</div>
    </div>
  );
}

// ===========================================================================
// PreviewPanel：识别完成后展示
// ===========================================================================
function PreviewPanel(props: {
  state: BubbleState;
  text: string;
  polished: string;
  injectResult: any;
  label: string;
  hotkeyConfig: any;
}) {
  const { state, text, polished, injectResult, label, hotkeyConfig } = props;
  const isPolishing = state === 'processing';

  // 从配置读快捷键，没有则用兜底（与默认设置保持一致）
  const kbConfirm = hotkeyConfig?.confirmInject ?? 'CommandOrControl+Alt+1';
  const kbPolished = hotkeyConfig?.injectPolished ?? 'Shift+2';
  const kbCancel = hotkeyConfig?.cancel ?? 'Escape';
  const [promptSlots, setPromptSlots] = useState<Array<{ name: string; accel: string }>>([]);

  useEffect(() => {
    window.voiceflow.getConfig().then((c: any) => {
      if (!c?.llm?.selectedPromptIds || !c?.llm?.prompts || !c?.hotkeys) return;
      const slots = c.llm.selectedPromptIds.slice(0, 5).map((id: string, i: number) => {
        const p = c.llm.prompts.find((x: any) => x.id === id);
        const accelKey = `aiOptimize${i + 1}`;
        return { accel: c.hotkeys[accelKey] || `Alt+${i + 1}`, name: p?.name || id };
      });
      setPromptSlots(slots);
    });
  }, [text]);

  const btnBase: React.CSSProperties = {
    padding: '6px 12px',
    background: 'rgba(255, 255, 255, 0.85)',
    border: '1px solid rgba(91, 141, 239, 0.25)',
    borderRadius: 6,
    color: '#1a1d29',
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    transition: 'all 0.15s',
  };

  const btnDisabled: React.CSSProperties = {
    ...btnBase,
    opacity: 0.4,
    cursor: 'not-allowed',
  };

  const btnAccent: React.CSSProperties = {
    ...btnBase,
    background: 'rgba(91, 141, 239, 0.12)',
    border: '1px solid rgba(91, 141, 239, 0.5)',
    color: '#1e40af',
  };

  const kbd: React.CSSProperties = {
    padding: '1px 5px',
    background: 'rgba(255, 255, 255, 0.95)',
    border: '1px solid rgba(0, 0, 0, 0.1)',
    borderRadius: 3,
    fontSize: 9,
    fontFamily: 'monospace',
    color: '#374151',
  };

  return (
    <div
      id="vf-preview-root"
      // preview 状态：阻止冒泡到根 onClick（虽然根在 isPreview 时不绑 onClick，但双保险）
      onClick={(e) => e.stopPropagation()}
      style={{
        width: '100%',
        padding: 14,
        background: 'rgba(255, 255, 255, 0.95)',
        borderRadius: 16,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.15)',
        color: '#1a1d29',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        fontSize: 13,
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      {/* 标题行 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: polished
                ? 'linear-gradient(135deg, #4ade80, #5b8def)'
                : isPolishing
                ? 'linear-gradient(135deg, #a78bfa, #5b8def)'
                : 'linear-gradient(135deg, #5b8def, #a78bfa)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {polished ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  border: '2px solid white',
                  borderTopColor: 'transparent',
                  animation: 'spin 1s linear infinite',
                }}
              />
            )}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1d29' }}>
            {polished ? '已优化' : isPolishing ? '✨ AI 优化中…' : '识别完成'}
          </div>
          {label && (
            <div style={{ fontSize: 9, color: '#6b7280', fontFamily: 'monospace' }}>{label}</div>
          )}
        </div>
      </div>

      {/* 原文 */}
      <div>
        <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4, padding: '0 4px' }}>
          识别文本
        </div>
        <div
          style={{
            padding: '8px 12px',
            background: 'rgba(0, 0, 0, 0.04)',
            borderRadius: 8,
            maxHeight: 80,
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: 12,
            lineHeight: 1.5,
            color: '#374151',
          }}
        >
          {text || <span style={{ color: '#9ca3af' }}>（空）</span>}
        </div>
      </div>

      {/* 优化中：等第一个 chunk 之前的占位（三个跳动的点） */}
      {isPolishing && !polished && (
        <div>
          <div style={{ fontSize: 10, color: '#a78bfa', marginBottom: 4, padding: '0 4px' }}>
            ✨ AI 优化中…
          </div>
          <div
            style={{
              padding: '8px 12px',
              background: 'rgba(167, 139, 250, 0.06)',
              border: '1px dashed rgba(167, 139, 250, 0.3)',
              borderRadius: 8,
              minHeight: 36,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#a78bfa',
                  display: 'inline-block',
                  animation: 'dotPulse 1.2s ease-in-out infinite',
                  animationDelay: `${i * 0.15}s`,
                }}
              />
            ))}
            <span style={{ fontSize: 10, color: '#6b7280', marginLeft: 4 }}>
              正在请求 LLM 接口…
            </span>
          </div>
        </div>
      )}

      {/* 优化中：已经开始流式返回，边收边显示 */}
      {isPolishing && polished && (
        <div>
          <div style={{ fontSize: 10, color: '#5b8def', marginBottom: 4, padding: '0 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#5b8def',
                animation: 'dotPulse 1.2s ease-in-out infinite',
                display: 'inline-block',
              }}
            />
            <span>✨ AI 优化中（流式接收中）</span>
          </div>
          <div
            style={{
              padding: '8px 12px',
              background: 'rgba(91, 141, 239, 0.08)',
              borderRadius: 8,
              maxHeight: 100,
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 12,
              lineHeight: 1.5,
              color: '#1a1d29',
            }}
          >
            {polished}
          </div>
        </div>
      )}

      {/* 优化完成 */}
      {!isPolishing && polished && (
        <div>
          <div style={{ fontSize: 10, color: '#5b8def', marginBottom: 4, padding: '0 4px' }}>
            ✨ AI 优化后
          </div>
          <div
            style={{
              padding: '8px 12px',
              background: 'rgba(91, 141, 239, 0.08)',
              borderRadius: 8,
              maxHeight: 100,
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 12,
              lineHeight: 1.5,
              color: '#1a1d29',
            }}
          >
            {polished}
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          padding: '8px 0 0',
          borderTop: '1px solid rgba(0, 0, 0, 0.08)',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {/* 注入原文 */}
          <button
            onClick={() => window.voiceflow.confirmInject(text)}
            disabled={!text}
            style={text ? btnBase : btnDisabled}
          >
            <span style={kbd}>{accelToDisplay(kbConfirm)}</span>
            <span>注入原文</span>
          </button>

          {/* 未优化：显示 AI 优化按钮（每个提示词一个） */}
          {!polished && promptSlots.map((slot, i) => (
            <button
              key={i}
              onClick={() => window.voiceflow.requestPolish(text, i)}
              disabled={!text || isPolishing}
              style={
                !text || isPolishing
                  ? { ...btnAccent, opacity: 0.4, cursor: 'not-allowed' }
                  : btnAccent
              }
            >
              <span style={kbd}>{accelToDisplay(slot.accel)}</span>
              <span>{isPolishing ? '优化中…' : slot.name}</span>
            </button>
          ))}

          {/* 已优化：显示注入优化（处理中也可注入当前已流出来的部分） */}
          {polished && (
            <button
              onClick={() => window.voiceflow.confirmInject(polished)}
              style={btnAccent}
            >
              <span style={kbd}>{accelToDisplay(kbPolished)}</span>
              <span>{isPolishing ? '注入当前' : '注入优化'}</span>
            </button>
          )}

          {/* 丢弃 */}
          <button
            onClick={() => window.voiceflow.discardPreview()}
            style={btnBase}
          >
            <span style={kbd}>{accelToDisplay(kbCancel)}</span>
            <span>丢弃</span>
          </button>
        </div>
      </div>

      {/* 注入结果反馈 */}
      {injectResult && (
        <div
          style={{
            fontSize: 11,
            padding: '6px 10px',
            borderRadius: 6,
            background: injectResult.ok ? 'rgba(74, 222, 128, 0.15)' : 'rgba(239, 68, 68, 0.15)',
            color: injectResult.ok ? '#15803d' : '#b91c1c',
          }}
        >
          {injectResult.message}
        </div>
      )}
    </div>
  );
}
