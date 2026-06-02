import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useVoiceflowStore } from '@/store';
import { useAudioCapture } from '@/hooks/useAudioCapture';

declare global {
  interface Window {
    voiceflow: any;
  }
}

export function FloatBubble() {
  const {
    bubbleState,
    setBubbleState,
    partialText,
    recordingSeconds,
    micVolume,
    llmOriginal,
    llmPolished,
    error,
    injectResult,
  } = useVoiceflowStore();

  // 录音时启动采集
  useAudioCapture(bubbleState === 'recording');

  // 录音计时
  useEffect(() => {
    if (bubbleState !== 'recording') return;
    const startedAt = Date.now() - recordingSeconds * 1000;
    const timer = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      useVoiceflowStore.getState().setRecordingSeconds(s);
    }, 200);
    return () => clearInterval(timer);
  }, [bubbleState, recordingSeconds]);

  // 监听主进程事件
  useEffect(() => {
    const subs: Array<() => void> = [];
    subs.push(
      window.voiceflow.on('state:change', (s: any) => {
        if (s === 'idle') {
          useVoiceflowStore.getState().setPartialText('');
          useVoiceflowStore.getState().setLlmOriginal('');
          useVoiceflowStore.getState().setLlmPolished('');
          useVoiceflowStore.getState().setError('');
          useVoiceflowStore.getState().setInjectResult(null);
        }
        setBubbleState(s);
      })
    );
    subs.push(
      window.voiceflow.on('asr:partial', (r: any) => {
        useVoiceflowStore.getState().setPartialText(r.text);
      })
    );
    subs.push(
      window.voiceflow.on('asr:final', (r: any) => {
        useVoiceflowStore.getState().setFinalText(r.text);
      })
    );
    subs.push(
      window.voiceflow.on('asr:error', (e: any) => {
        useVoiceflowStore.getState().setError(e.message);
        setBubbleState('idle');
        setTimeout(() => window.voiceflow.hideFloat(), 2000);
      })
    );
    subs.push(
      window.voiceflow.on('llm:start', (r: any) => {
        useVoiceflowStore.getState().setLlmOriginal(r.original);
        useVoiceflowStore.getState().setLlmPolished('');
      })
    );
    subs.push(
      window.voiceflow.on('llm:chunk', (r: any) => {
        useVoiceflowStore.getState().setLlmPolished(r.text);
      })
    );
    subs.push(
      window.voiceflow.on('llm:done', (r: any) => {
        useVoiceflowStore.getState().setLlmPolished(r.text);
      })
    );
    subs.push(
      window.voiceflow.on('inject:result', (r: any) => {
        useVoiceflowStore.getState().setInjectResult(r);
      })
    );
    return () => subs.forEach((u) => u());
  }, [setBubbleState]);

  // 拖拽
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.no-drag')) return;
    if (e.button !== 0) return;
    let lastX = e.screenX;
    let lastY = e.screenY;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.screenX - lastX;
      const dy = ev.screenY - lastY;
      lastX = ev.screenX;
      lastY = ev.screenY;
      window.voiceflow.moveFloat(dx, dy);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      className="w-full h-full flex items-center justify-center"
      onMouseDown={handleMouseDown}
    >
      <AnimatePresence mode="wait">
        {(bubbleState === 'preview' || bubbleState === 'processing') && llmOriginal ? (
          <PreviewPanel key="preview" />
        ) : (
          <CircularBubble key="bubble" />
        )}
      </AnimatePresence>
    </div>
  );
}

function CircularBubble() {
  const { bubbleState, partialText, recordingSeconds, micVolume, error } =
    useVoiceflowStore();

  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.9, opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className={`
        relative cursor-pointer
        w-[200px] h-[200px] rounded-glass
        glass shadow-glass-lg
        flex flex-col items-center justify-center
        overflow-hidden
        ${bubbleState === 'idle' ? 'animate-breathe' : ''}
      `}
    >
      <div
        className={`absolute inset-0 bg-gradient-to-br ${
          bubbleState === 'recording'
            ? 'from-primary-400/30 to-accent-500/30'
            : bubbleState === 'processing'
            ? 'from-accent-400/30 to-primary-400/30'
            : 'from-primary-400/15 to-accent-500/15'
        } transition-all duration-700`}
      />
      <div className="absolute inset-0 rounded-glass pointer-events-none ring-1 ring-inset ring-white/40" />

      {bubbleState === 'recording' && (
        <>
          <div className="recording-ring" style={{ animationDelay: '0s' }} />
          <div className="recording-ring" style={{ animationDelay: '0.6s' }} />
        </>
      )}

      <div className="relative z-10 flex flex-col items-center gap-3">
        {bubbleState === 'recording' ? (
          <div className="flex items-end gap-1.5 h-10">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="voice-bar"
                style={{ height: `${10 + micVolume * 80}px` }}
              />
            ))}
          </div>
        ) : bubbleState === 'processing' ? (
          <motion.div
            className="w-10 h-10 rounded-full border-[3px] border-accent-400/30 border-t-accent-500"
            animate={{ rotate: 360 }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
          />
        ) : error ? (
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-danger-400 to-danger-500 flex items-center justify-center shadow-glass-sm">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
        ) : (
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-400 to-accent-500 flex items-center justify-center shadow-primary-glow">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </div>
        )}

        <div className="text-center px-4">
          <div className="text-[13px] font-semibold text-ink-900 leading-tight">
            {error
              ? error
              : bubbleState === 'recording'
              ? '正在聆听…'
              : bubbleState === 'processing'
              ? 'AI 优化中…'
              : '按 Ctrl+Alt+Z 说话'}
          </div>
          <div className="text-[10px] text-ink-500 mt-0.5">
            {bubbleState === 'recording'
              ? '说完自动停止'
              : bubbleState === 'processing'
              ? '请稍候'
              : '也可点击浮窗'}
          </div>
          {bubbleState === 'recording' && (
            <div className="text-[11px] font-mono text-primary-500 mt-1">
              {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:
              {String(recordingSeconds % 60).padStart(2, '0')}
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {bubbleState === 'recording' && partialText && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 max-w-[220px] px-3 py-1.5 glass rounded-bubble shadow-glass-sm text-[11px] text-ink-700 text-center"
          >
            {partialText}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function PreviewPanel() {
  const { llmOriginal, llmPolished, injectResult, bubbleState } =
    useVoiceflowStore();
  const isPolishing = bubbleState === 'processing';
  const hasPolished = !!llmPolished;

  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0, y: 8 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={{ scale: 0.9, opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className="w-[360px] glass-strong rounded-glass shadow-glass-lg p-3.5 flex flex-col gap-2.5"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={`w-6 h-6 rounded-full flex items-center justify-center transition ${
              isPolishing
                ? 'bg-gradient-to-br from-accent-400 to-primary-400'
                : hasPolished
                ? 'bg-gradient-to-br from-success-400 to-primary-400'
                : 'bg-gradient-to-br from-primary-400 to-accent-500'
            }`}
          >
            {isPolishing ? (
              <span className="block w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
          <div className="text-[12px] font-semibold text-ink-900">
            {isPolishing ? 'AI 优化中…' : hasPolished ? '已优化' : '识别完成'}
          </div>
        </div>
      </div>

      {/* 原文 */}
      <div className="flex flex-col gap-1">
        <div className="text-[10px] text-ink-500 px-1">识别文本</div>
        <div className="px-3 py-2 bg-white/40 rounded-lg text-[12px] text-ink-700 max-h-[80px] overflow-y-auto">
          {llmOriginal}
        </div>
      </div>

      {/* 优化后 */}
      {hasPolished && (
        <div className="flex flex-col gap-1">
          <div className="text-[10px] text-accent-500 px-1">✨ AI 优化后</div>
          <div className="relative px-3 py-2 bg-white/70 rounded-lg text-[12px] text-ink-900 max-h-[100px] overflow-y-auto">
            {llmPolished}
          </div>
        </div>
      )}

      {/* 快捷键提示（不再用按钮） */}
      <div className="flex flex-col gap-1 px-1 pt-1 border-t border-white/40">
        <div className="text-[10px] text-ink-500">快捷键操作（焦点保持在目标输入框）</div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-ink-700">
          <span>
            <kbd className="px-1.5 py-0.5 bg-white/60 rounded text-[9px] font-mono">Ctrl+Alt+1</kbd>
            <span className="ml-1">注入原文</span>
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 bg-white/60 rounded text-[9px] font-mono">Ctrl+Alt+2</kbd>
            <span className="ml-1">AI 优化 + 注入</span>
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 bg-white/60 rounded text-[9px] font-mono">Esc</kbd>
            <span className="ml-1">丢弃</span>
          </span>
        </div>
      </div>

      {injectResult && (
        <div
          className={`text-[10px] px-2 py-1 rounded ${
            injectResult.ok
              ? 'bg-success-400/20 text-success-500'
              : 'bg-danger-400/20 text-danger-500'
          }`}
        >
          {injectResult.message}
        </div>
      )}
    </motion.div>
  );
}
