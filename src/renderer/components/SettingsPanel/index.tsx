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
    prompts: [] as any[],
    activePromptId: 'builtin-standard',
    selectedPromptIds: ['builtin-standard'] as string[],
  },
  hotkeys: {
    pushToTalk: 'CommandOrControl+Alt+Z',
    pushToTalkWithAI: 'CommandOrControl+Alt+X',
    cancel: 'Escape',
    toggleMode: 'Tab',
    openSettings: 'CommandOrControl+,',
    openHistory: 'CommandOrControl+Shift+H',
    confirmInject: 'CommandOrControl+Alt+1',
    injectPolished: 'Shift+@',
    aiOptimize1: 'Alt+1',
    aiOptimize2: 'Alt+2',
    aiOptimize3: 'Alt+3',
    aiOptimize4: 'Alt+4',
    aiOptimize5: 'Alt+5',
  },
  appearance: {
    position: 'center-bottom' as const,
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

  // 提示词管理
  const [showPromptForm, setShowPromptForm] = useState(false);
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [promptForm, setPromptForm] = useState({ name: '', description: '', prompt: '' });

  useEffect(() => {
    window.voiceflow.getConfig().then((c) => {
      if (c) {
        setForm({
          tencentASR: { ...DEFAULT_FORM.tencentASR, ...c.tencentASR },
          asr: { ...DEFAULT_FORM.asr, ...(c.asr || {}) },
          llm: {
            ...DEFAULT_FORM.llm,
            ...c.llm,
            prompts: c.llm?.prompts?.length ? c.llm.prompts : DEFAULT_FORM.llm.prompts,
            selectedPromptIds: c.llm?.selectedPromptIds?.length ? c.llm.selectedPromptIds : DEFAULT_FORM.llm.selectedPromptIds,
          },
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
              { key: 'llm-model', label: '🤖 优化模型' },
              { key: 'llm-prompt', label: '💬 提示词管理' },
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
              <Section
                title={
                  <div className="flex items-center gap-2 flex-wrap">
                    <span>语音识别</span>
                    <span className="text-[10px] px-2 py-0.5 bg-primary-400 text-white rounded font-semibold">腾讯云</span>
                  </div>
                }
                desc="配置腾讯云 ASR 在线识别（每月赠送数小时免费额度）"
              >
                {/* 获取免费额度链接 */}
                <div className="flex items-center justify-between px-3 py-2.5 bg-gradient-to-r from-primary-50 to-accent-50 rounded-lg border border-primary-200/50">
                  <div>
                    <div className="text-sm font-semibold text-ink-900">🎁 腾讯云 ASR 新用户免费额度</div>
                    <div className="text-[11px] text-ink-500 mt-0.5">每月赠送数小时免费转写额度，足够日常使用</div>
                  </div>
                  <button
                    onClick={() => window.voiceflow.openExternal('https://cloud.tencent.com/product/asr')}
                    className="text-xs px-3 py-1.5 bg-white text-primary-600 border border-primary-300 rounded-md hover:bg-primary-50 transition font-semibold shrink-0"
                  >
                    前往领取 →
                  </button>
                </div>

                <Field label="AppId">
                  <input className={inputCls} value={form.tencentASR.appId}
                    onChange={(e) => update('tencentASR.appId', e.target.value)} placeholder="1400000000" />
                </Field>
                <Field label="SecretId">
                  <input className={inputCls} value={form.tencentASR.secretId}
                    onChange={(e) => update('tencentASR.secretId', e.target.value)} placeholder="AKID..." />
                </Field>
                <Field label="SecretKey">
                  <input type="password" className={inputCls} value={form.tencentASR.secretKey}
                    onChange={(e) => update('tencentASR.secretKey', e.target.value)} placeholder="••••••••" />
                </Field>
                <Field label="引擎类型">
                  <select className={inputCls} value={form.tencentASR.engineType}
                    onChange={(e) => update('tencentASR.engineType', e.target.value as any)}>
                    <option value="16k_zh">中文 (16k_zh)</option>
                    <option value="16k_zh-PY">中英混合 (16k_zh-PY) ⭐</option>
                    <option value="16k_en">英文 (16k_en)</option>
                  </select>
                </Field>

                {/* 1/2/3 教程：教用户怎么获取凭证 */}
                <div className="mt-2 px-4 py-4 bg-white/40 border border-white/60 rounded-xl space-y-3">
                  <div className="text-sm font-semibold text-ink-900">📖 如何获取腾讯云 ASR 凭证？</div>
                  <ol className="space-y-2.5 text-[12px] text-ink-700">
                    <li className="flex gap-2.5">
                      <span className="shrink-0 w-5 h-5 rounded-full bg-primary-400 text-white text-[10px] font-bold flex items-center justify-center">1</span>
                      <div className="flex-1">
                        <div className="font-semibold text-ink-900">注册腾讯云账号并实名认证</div>
                        <button onClick={() => window.voiceflow.openExternal('https://cloud.tencent.com/register')}
                          className="text-primary-500 hover:underline text-[11px] mt-0.5">
                          打开注册页 →
                        </button>
                      </div>
                    </li>
                    <li className="flex gap-2.5">
                      <span className="shrink-0 w-5 h-5 rounded-full bg-primary-400 text-white text-[10px] font-bold flex items-center justify-center">2</span>
                      <div className="flex-1">
                        <div className="font-semibold text-ink-900">开通「语音识别 ASR」服务</div>
                        <div className="text-[11px] text-ink-500 mt-0.5">首次开通每月赠送数小时免费额度（够日常用）</div>
                        <button onClick={() => window.voiceflow.openExternal('https://console.cloud.tencent.com/asr')}
                          className="text-primary-500 hover:underline text-[11px] mt-0.5">
                          打开控制台 →
                        </button>
                      </div>
                    </li>
                    <li className="flex gap-2.5">
                      <span className="shrink-0 w-5 h-5 rounded-full bg-primary-400 text-white text-[10px] font-bold flex items-center justify-center">3</span>
                      <div className="flex-1">
                        <div className="font-semibold text-ink-900">创建应用获取密钥</div>
                        <div className="text-[11px] text-ink-500 mt-0.5">控制台 → 语音识别 → <b>应用管理</b> → 新建应用 → 复制 <code className="px-1 py-0.5 bg-ink-100 rounded">AppId</code> / <code className="px-1 py-0.5 bg-ink-100 rounded">SecretId</code> / <code className="px-1 py-0.5 bg-ink-100 rounded">SecretKey</code> 填到上面表单</div>
                        <button onClick={() => window.voiceflow.openExternal('https://console.cloud.tencent.com/asr/app')}
                          className="text-primary-500 hover:underline text-[11px] mt-0.5">
                          直接打开应用管理 →
                        </button>
                      </div>
                    </li>
                  </ol>
                </div>
              </Section>
            )}

            {activeSection === 'llm-model' && (
              <Section title="优化模型" desc="配置 OpenAI 兼容的 LLM 接口">
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
                <Tip>配置后可在「提示词管理」中选择不同场景的提示词</Tip>
              </Section>
            )}

            {activeSection === 'llm-prompt' && (
              <Section title="提示词管理" desc="勾选最多5个提示词绑定到 Alt+1~5 快捷键">
                {/* 4列网格 */}
                <div className="flex flex-col gap-2">
                  {(form.llm.prompts || []).map((p: any) => {
                    const selIdx = (form.llm.selectedPromptIds || []).indexOf(p.id);
                    const isSelected = selIdx >= 0;
                    return (
                      <div
                        key={p.id}
                        onClick={() => {
                          // 内置：点击卡片不做任何事（不能编辑/删除）
                          // 自定义：点击卡片 → 编辑
                          if (!p.isBuiltin) {
                            setEditingPromptId(p.id);
                            setPromptForm({ name: p.name, description: p.description, prompt: p.prompt });
                            setShowPromptForm(true);
                          }
                        }}
                        className={`relative p-2 rounded-lg border transition flex items-center gap-3 ${
                          p.isBuiltin
                            ? isSelected
                              ? 'border-primary-400 bg-primary-50 ring-1 ring-primary-400/30 cursor-default'
                              : 'border-white/60 bg-white/40 cursor-default'
                            : isSelected
                              ? 'border-primary-400 bg-primary-50 ring-1 ring-primary-400/30 cursor-pointer'
                              : 'border-white/60 bg-white/40 hover:bg-white/60 cursor-pointer'
                        }`}
                      >
                        <div className="text-xl">{p.id === 'builtin-standard' ? '📝' : p.id === 'builtin-formal' ? '📧' : p.id === 'builtin-chat' ? '💬' : p.id === 'builtin-blog' ? '📰' : p.id === 'builtin-vibecoding' ? '💻' : p.id === 'builtin-lindaiyu' ? '🌸' : '✨'}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-ink-900">{p.name}</span>
                            {p.isBuiltin && <span className="text-[10px] px-1 py-0.5 bg-ink-300/10 text-ink-500 rounded shrink-0">内置</span>}
                            {isSelected && <span className="text-[10px] px-1 py-0.5 bg-primary-100 text-primary-500 rounded font-mono shrink-0">Alt+{selIdx + 1}</span>}
                          </div>
                          <p className="text-[11px] text-ink-500 truncate">{p.description}</p>
                        </div>
                        {/* 右侧操作：勾选 + (仅自定义) 编辑/删除 */}
                        <div className="shrink-0 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          {!p.isBuiltin && (
                            <>
                              <button
                                title="编辑"
                                onClick={() => {
                                  setEditingPromptId(p.id);
                                  setPromptForm({ name: p.name, description: p.description, prompt: p.prompt });
                                  setShowPromptForm(true);
                                }}
                                className="w-6 h-6 rounded text-ink-400 hover:text-primary-500 hover:bg-primary-50 text-[11px] flex items-center justify-center"
                              >✎</button>
                              <button
                                title="删除"
                                onClick={() => {
                                  if (!confirm(`删除自定义提示词"${p.name}"？\n绑定到该提示词的快捷键也会一并解除。`)) return;
                                  const newPrompts = form.llm.prompts.filter((x: any) => x.id !== p.id);
                                  const newSel = (form.llm.selectedPromptIds || []).filter((id: string) => id !== p.id);
                                  update('llm.prompts', newPrompts);
                                  update('llm.selectedPromptIds', newSel);
                                  if (form.llm.activePromptId === p.id) {
                                    update('llm.activePromptId', 'builtin-standard');
                                  }
                                }}
                                className="w-6 h-6 rounded text-ink-400 hover:text-red-500 hover:bg-red-50 text-[11px] flex items-center justify-center"
                              >🗑</button>
                            </>
                          )}
                          {isSelected ? (
                            <button
                              title="解除绑定"
                              onClick={() => {
                                const ids = [...form.llm.selectedPromptIds];
                                ids.splice(selIdx, 1);
                                update('llm.selectedPromptIds', ids);
                              }}
                              className="w-6 h-6 rounded-full bg-primary-400 text-white text-xs font-bold flex items-center justify-center"
                            >{selIdx + 1}</button>
                          ) : (
                            <button
                              title="绑定到下一个空闲快捷键"
                              onClick={() => {
                                const ids = [...(form.llm.selectedPromptIds || [])];
                                if (ids.length >= 5) return;
                                ids.push(p.id);
                                update('llm.selectedPromptIds', ids);
                              }}
                              disabled={(form.llm.selectedPromptIds || []).length >= 5}
                              className="w-6 h-6 rounded-full border-2 border-ink-300 text-ink-300 text-xs flex items-center justify-center hover:border-primary-400 hover:text-primary-400 disabled:opacity-30"
                            >+</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 选中排序提示 */}
                {(form.llm.selectedPromptIds || []).length > 0 && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-ink-500">
                    <span>快捷键绑定顺序：</span>
                    {(form.llm.selectedPromptIds || []).map((id, i) => {
                      const p = (form.llm.prompts || []).find((x: any) => x.id === id);
                      return (
                        <span key={id} className="px-2 py-0.5 bg-primary-50 text-primary-500 rounded font-mono">
                          Alt+{i + 1} {p?.name || id}
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* 新建/编辑按钮 */}
                <button onClick={() => { setShowPromptForm(true); setEditingPromptId(null); setPromptForm({ name: '', description: '', prompt: '' }); }}
                  className="mt-3 w-full py-3 text-sm font-semibold text-primary-500 bg-white/60 border-2 border-dashed border-primary-400/30 rounded-xl hover:bg-primary-50 transition">
                  + 新建提示词
                </button>
              </Section>
            )}

            {/* 提示词编辑弹窗 */}
            {showPromptForm && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => { setShowPromptForm(false); setEditingPromptId(null); }}>
                <div className="bg-white rounded-2xl shadow-glass-lg p-6 w-[480px] space-y-4" onClick={(e) => e.stopPropagation()}>
                  <div className="text-lg font-bold text-ink-900">{editingPromptId ? '编辑提示词' : '新建提示词'}</div>
                  <input className={inputCls} placeholder="名称" value={promptForm.name}
                    onChange={(e) => setPromptForm((f) => ({ ...f, name: e.target.value }))} />
                  <input className={inputCls} placeholder="简短描述" value={promptForm.description}
                    onChange={(e) => setPromptForm((f) => ({ ...f, description: e.target.value }))} />
                  <textarea className={`${inputCls} min-h-[140px] font-mono text-xs`} placeholder="System Prompt 全文…"
                    value={promptForm.prompt}
                    onChange={(e) => setPromptForm((f) => ({ ...f, prompt: e.target.value }))} />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => { setShowPromptForm(false); setEditingPromptId(null); setPromptForm({ name: '', description: '', prompt: '' }); }}
                      className="px-4 py-2 text-sm text-ink-700 bg-ink-100 rounded-lg hover:bg-ink-200 transition">取消</button>
                    <button
                      onClick={() => {
                        if (!promptForm.name || !promptForm.prompt) return;
                        if (editingPromptId) {
                          update('llm.prompts', form.llm.prompts.map((p: any) =>
                            p.id === editingPromptId ? { ...p, name: promptForm.name, description: promptForm.description, prompt: promptForm.prompt } : p));
                        } else {
                          const np = { id: `custom-${Date.now()}`, name: promptForm.name, description: promptForm.description, prompt: promptForm.prompt, isBuiltin: false };
                          update('llm.prompts', [...form.llm.prompts, np]);
                        }
                        setShowPromptForm(false); setEditingPromptId(null);
                        setPromptForm({ name: '', description: '', prompt: '' });
                      }}
                      disabled={!promptForm.name || !promptForm.prompt}
                      className="px-5 py-2 text-sm font-semibold text-white bg-gradient-to-br from-primary-400 to-accent-500 rounded-lg hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {editingPromptId ? '💾 保存' : '✨ 创建'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'hotkey' && (
              <Section title="快捷键" desc="点击对应项，按下新的组合键以重新录制">
                {(
                  [
                    ['pushToTalk', '推说（普通）'],
                    ['pushToTalkWithAI', '推说（带 AI 优化）'],
                    ['confirmInject', '注入原文'],
                    ['injectPolished', '注入AI优化结果'],
                    ['aiOptimize1', 'AI 优化 #1'],
                    ['aiOptimize2', 'AI 优化 #2'],
                    ['aiOptimize3', 'AI 优化 #3'],
                    ['aiOptimize4', 'AI 优化 #4'],
                    ['aiOptimize5', 'AI 优化 #5'],
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
                <Tip>Esc / Tab 在录音/预览时全局生效；其他快捷键始终为系统级全局</Tip>
              </Section>
            )}

            {activeSection === 'appearance' && (
              <Section title="外观" desc="调整浮窗位置、透明度与主题">
                <Field label="浮窗位置">
                  <div className="grid grid-cols-3 gap-2">
                    {((
                      [
                        ['top-left', '左上'],
                        ['center-top', '中上'],
                        ['top-right', '右上'],
                        ['bottom-left', '左下'],
                        ['center-bottom', '中下'],
                        ['bottom-right', '右下'],
                      ] as const
                    ).map(([val, label]) => (
                        <button
                          key={val}
                          onClick={() => update('appearance.position', val)}
                          className={`px-3 py-2 text-sm rounded-lg border transition ${
                            form.appearance.position === val
                              ? 'border-primary-400 bg-primary-50 text-primary-500 font-semibold'
                              : 'border-white/60 bg-white/40 text-ink-700 hover:bg-white/60'
                          }`}
                        >
                          {label}
                        </button>
                      )
                    ))}
                  </div>
                </Field>
                <Field label={`不透明度 (${Math.round(form.appearance.opacity * 100)}%)`}>
                  <input
                    type="range"
                    min="0.1"
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
  title: React.ReactNode;
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
