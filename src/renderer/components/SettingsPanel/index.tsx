import { useEffect, useState } from 'react';

declare global {
  interface Window {
    voiceflow: {
      getConfig: () => Promise<any>;
      saveConfig: (c: any) => Promise<boolean>;
      [k: string]: any;
    };
  }
}

const DEFAULT_FORM = {
  tencentASR: {
    appId: '',
    secretId: '',
    secretKey: '',
    engineType: '16k_zh-PY' as const,
  },
  llm: {
    baseURL: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    systemPrompt: '',
    enableAI: true,
  },
  hotkeys: {
    pushToTalk: 'CommandOrControl+Alt+Z',
    pushToTalkWithAI: 'CommandOrControl+Alt+X',
    cancel: 'Escape',
    toggleMode: 'Tab',
    openSettings: 'CommandOrControl+,',
    openHistory: 'CommandOrControl+Shift+H',
  },
  appearance: {
    position: 'bottom-right' as const,
    opacity: 1,
    theme: 'light' as const,
  },
  general: {
    autoLaunch: false,
    startMinimized: false,
    injectMode: 'replace' as const,
  },
  history: {
    enabled: true,
  },
};

type FormData = typeof DEFAULT_FORM;

export function SettingsPanel() {
  const [form, setForm] = useState<FormData>(DEFAULT_FORM);
  const [activeSection, setActiveSection] = useState<string>('asr');
  const [saved, setSaved] = useState<boolean>(false);
  const [recordingKey, setRecordingKey] = useState<string | null>(null);

  useEffect(() => {
    window.voiceflow.getConfig().then((c) => {
      if (c) {
        setForm({
          tencentASR: { ...DEFAULT_FORM.tencentASR, ...c.tencentASR },
          llm: { ...DEFAULT_FORM.llm, ...c.llm },
          hotkeys: { ...DEFAULT_FORM.hotkeys, ...c.hotkeys },
          appearance: { ...DEFAULT_FORM.appearance, ...c.appearance },
          general: { ...DEFAULT_FORM.general, ...c.general },
          history: { ...DEFAULT_FORM.history, ...c.history },
        });
      }
    });
  }, []);

  const update = (path: string, value: any) => {
    setForm((prev) => {
      const next: any = { ...prev };
      const keys = path.split('.');
      let obj: any = next;
      for (let i = 0; i < keys.length - 1; i++) {
        obj[keys[i]] = { ...obj[keys[i]] };
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return next;
    });
    setSaved(false);
  };

  const handleSave = async () => {
    await window.voiceflow.saveConfig(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // 录制快捷键
  useEffect(() => {
    if (!recordingKey) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const parts: string[] = [];
      if (e.ctrlKey) parts.push('CommandOrControl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      // 主键
      let main = e.key;
      if (main === ' ') main = 'Space';
      if (main === 'Escape') main = 'Escape';
      if (main === 'Tab') main = 'Tab';
      if (main.length === 1) main = main.toUpperCase();
      if (main !== 'Control' && main !== 'Alt' && main !== 'Shift' && main !== 'Meta') {
        parts.push(main);
        const accel = parts.join('+');
        update(`hotkeys.${recordingKey}`, accel);
        setRecordingKey(null);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [recordingKey]);

  return (
    <div className="w-full h-full bg-bg-base overflow-y-auto">
      <div className="max-w-5xl mx-auto p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-ink-900">VoiceFlow 设置</h1>
            <p className="text-sm text-ink-500 mt-1">配置 ASR、LLM、快捷键与外观</p>
          </div>
          <div className="flex items-center gap-3">
            {saved && (
              <span className="text-xs text-success-500 animate-fade-in-up">已保存</span>
            )}
            <button
              onClick={handleSave}
              className="px-5 py-2 text-sm font-semibold text-white bg-gradient-to-br from-primary-400 to-accent-500 rounded-lg shadow-primary-glow hover:opacity-90 transition"
            >
              保存设置
            </button>
          </div>
        </div>

        <div className="grid grid-cols-[200px_1fr] gap-6">
          {/* Sidebar */}
          <nav className="flex flex-col gap-1">
            {[
              { key: 'asr', label: '🎙 语音识别' },
              { key: 'llm', label: '✨ AI 优化' },
              { key: 'hotkey', label: '⌨️ 快捷键' },
              { key: 'appearance', label: '🎨 外观' },
              { key: 'general', label: '⚙️ 通用' },
              { key: 'history', label: '📝 历史' },
            ].map((item) => (
              <button
                key={item.key}
                onClick={() => setActiveSection(item.key)}
                className={`text-left px-4 py-2.5 rounded-lg text-sm transition ${
                  activeSection === item.key
                    ? 'bg-white/80 text-ink-900 font-semibold shadow-glass-sm'
                    : 'text-ink-700 hover:bg-white/40'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-6 shadow-glass-sm border border-white/60 space-y-6">
            {activeSection === 'asr' && (
              <Section title="腾讯云 ASR" desc="用于流式语音识别（实时 WebSocket 接口）">
                <Field label="AppId">
                  <input
                    className={inputCls}
                    value={form.tencentASR.appId}
                    onChange={(e) => update('tencentASR.appId', e.target.value)}
                    placeholder="1400000000"
                  />
                </Field>
                <Field label="SecretId">
                  <input
                    className={inputCls}
                    value={form.tencentASR.secretId}
                    onChange={(e) => update('tencentASR.secretId', e.target.value)}
                    placeholder="AKID..."
                  />
                </Field>
                <Field label="SecretKey">
                  <input
                    type="password"
                    className={inputCls}
                    value={form.tencentASR.secretKey}
                    onChange={(e) => update('tencentASR.secretKey', e.target.value)}
                    placeholder="••••••••"
                  />
                </Field>
                <Field label="引擎类型">
                  <select
                    className={inputCls}
                    value={form.tencentASR.engineType}
                    onChange={(e) => update('tencentASR.engineType', e.target.value as any)}
                  >
                    <option value="16k_zh">中文 (16k_zh)</option>
                    <option value="16k_zh-PY">中英混合 (16k_zh-PY) ⭐</option>
                    <option value="16k_en">英文 (16k_en)</option>
                  </select>
                </Field>
                <Tip>
                  申请地址：<a className="text-primary-400 underline" href="https://console.cloud.tencent.com/asr">腾讯云控制台 - 语音识别</a>
                </Tip>
              </Section>
            )}

            {activeSection === 'llm' && (
              <Section title="AI 优化" desc="可选地对识别文本进行润色（OpenAI 兼容协议）">
                <Field label="启用 AI 优化">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.llm.enableAI}
                      onChange={(e) => update('llm.enableAI', e.target.checked)}
                      className="w-4 h-4"
                    />
                    <span className="text-sm text-ink-700">启用</span>
                  </label>
                </Field>
                <Field label="Base URL">
                  <input
                    className={inputCls}
                    value={form.llm.baseURL}
                    onChange={(e) => update('llm.baseURL', e.target.value)}
                    placeholder="https://api.openai.com/v1"
                  />
                </Field>
                <Field label="API Key">
                  <input
                    type="password"
                    className={inputCls}
                    value={form.llm.apiKey}
                    onChange={(e) => update('llm.apiKey', e.target.value)}
                    placeholder="sk-..."
                  />
                </Field>
                <Field label="Model">
                  <input
                    className={inputCls}
                    value={form.llm.model}
                    onChange={(e) => update('llm.model', e.target.value)}
                    placeholder="gpt-4o-mini"
                  />
                </Field>
                <Field label="System Prompt">
                  <textarea
                    className={`${inputCls} min-h-[140px] font-mono text-xs`}
                    value={form.llm.systemPrompt}
                    onChange={(e) => update('llm.systemPrompt', e.target.value)}
                    placeholder="你是一个文本润色助手..."
                  />
                </Field>
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      update(
                        'llm.systemPrompt',
                        '你是一个文本润色助手。任务：\n1. 去除口语化表达（嗯、那个、就是说、然后…）\n2. 修正语法错误、错别字\n3. 规范化标点符号\n4. 保持原意不变，不增删关键信息\n5. 输出简洁清晰的书面中文\n\n直接输出润色后的文本，不要任何解释或前缀。'
                      )
                    }
                    className="text-xs px-3 py-1.5 bg-white/60 rounded-lg hover:bg-white/80 transition"
                  >
                    📋 默认模板
                  </button>
                  <button
                    onClick={() =>
                      update(
                        'llm.systemPrompt',
                        '你是简洁编辑。任务：把用户口述压缩为最简表达，删除所有冗余词、不改变事实。\n直接输出结果。'
                      )
                    }
                    className="text-xs px-3 py-1.5 bg-white/60 rounded-lg hover:bg-white/80 transition"
                  >
                    ✂️ 简洁模板
                  </button>
                </div>
              </Section>
            )}

            {activeSection === 'hotkey' && (
              <Section title="快捷键" desc="点击对应项，按下新的组合键以重新录制">
                {(
                  [
                    ['pushToTalk', '推说（普通）'],
                    ['pushToTalkWithAI', '推说（带 AI 优化）'],
                    ['cancel', '取消'],
                    ['toggleMode', '切换 覆盖/追加 模式'],
                    ['openSettings', '打开设置'],
                    ['openHistory', '打开历史'],
                  ] as const
                ).map(([key, label]) => (
                  <Field key={key} label={label}>
                    <button
                      onClick={() => setRecordingKey(key)}
                      className={`${inputCls} text-left ${
                        recordingKey === key
                          ? 'ring-2 ring-primary-400 bg-primary-50'
                          : ''
                      }`}
                    >
                      {recordingKey === key
                        ? '请按下新快捷键…'
                        : form.hotkeys[key as keyof typeof form.hotkeys] || '未设置'}
                    </button>
                  </Field>
                ))}
                <Tip>Esc / Tab 在应用内生效；其他快捷键为系统级全局</Tip>
              </Section>
            )}

            {activeSection === 'appearance' && (
              <Section title="外观" desc="调整浮窗位置、透明度与主题">
                <Field label="浮窗位置">
                  <div className="grid grid-cols-2 gap-2">
                    {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map(
                      (p) => (
                        <button
                          key={p}
                          onClick={() => update('appearance.position', p)}
                          className={`px-3 py-2 text-sm rounded-lg border transition ${
                            form.appearance.position === p
                              ? 'border-primary-400 bg-primary-50 text-primary-500 font-semibold'
                              : 'border-white/60 bg-white/40 text-ink-700 hover:bg-white/60'
                          }`}
                        >
                          {p.replace('-', ' ')}
                        </button>
                      )
                    )}
                  </div>
                </Field>
                <Field label={`透明度 (${Math.round(form.appearance.opacity * 100)}%)`}>
                  <input
                    type="range"
                    min="0.5"
                    max="1"
                    step="0.05"
                    value={form.appearance.opacity}
                    onChange={(e) => update('appearance.opacity', parseFloat(e.target.value))}
                    className="w-full"
                  />
                </Field>
                <Field label="主题">
                  <select
                    className={inputCls}
                    value={form.appearance.theme}
                    onChange={(e) => update('appearance.theme', e.target.value as any)}
                  >
                    <option value="light">浅色</option>
                    <option value="dark">深色（暂未适配）</option>
                    <option value="system">跟随系统</option>
                  </select>
                </Field>
              </Section>
            )}

            {activeSection === 'general' && (
              <Section title="通用" desc="启动行为与文本注入">
                <Field label="开机自启">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.general.autoLaunch}
                      onChange={(e) => update('general.autoLaunch', e.target.checked)}
                      className="w-4 h-4"
                    />
                    <span className="text-sm text-ink-700">Windows 启动时自动运行</span>
                  </label>
                </Field>
                <Field label="默认注入模式">
                  <div className="flex bg-white/60 rounded-lg p-0.5 w-fit">
                    {(['replace', 'append'] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => update('general.injectMode', m)}
                        className={`px-4 py-1.5 text-sm rounded-md transition ${
                          form.general.injectMode === m
                            ? 'bg-primary-400 text-white'
                            : 'text-ink-700'
                        }`}
                      >
                        {m === 'replace' ? '覆盖' : '追加'}
                      </button>
                    ))}
                  </div>
                </Field>
              </Section>
            )}

            {activeSection === 'history' && (
              <Section title="历史记录" desc="自动保留最近 30 条识别结果">
                <Field label="启用历史记录">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.history.enabled}
                      onChange={(e) => update('history.enabled', e.target.checked)}
                      className="w-4 h-4"
                    />
                    <span className="text-sm text-ink-700">记录每次识别结果</span>
                  </label>
                </Field>
                <Tip>关闭后不再写入历史，但已有记录仍会保留</Tip>
              </Section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  'w-full px-3 py-2 bg-white/60 border border-white/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/50 focus:bg-white/80 transition';

function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-ink-900">{title}</h2>
        <p className="text-xs text-ink-500 mt-1">{desc}</p>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-3">
      <label className="text-sm text-ink-700 pt-2">{label}</label>
      <div>{children}</div>
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs text-ink-500 px-3 py-2 bg-primary-50/40 rounded-lg">
      {children}
    </div>
  );
}
