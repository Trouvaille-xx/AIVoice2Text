import { useEffect, useState, useCallback } from 'react';
import type { ModelDownloadProgress } from '@shared/types';

declare global {
  interface Window {
    voiceflow: {
      getConfig: () => Promise<any>;
      saveConfig: (c: any) => Promise<boolean>;
      listModels: () => Promise<Array<any>>;
      downloadModel: (id: string) => Promise<{ ok: boolean; error?: string }>;
      cancelDownload: (id: string) => void;
      deleteModel: (id: string) => Promise<boolean>;
      on: (channel: string, handler: (payload: any) => void) => () => void;
      openExternal: (url: string) => void;
      [k: string]: any;
    };
  }
}

/* ───────── inline SVG icons (16×16, stroke-based) ───────── */
const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const ICONS: Record<string, string> = {
  mic:     'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z M19 10v2a7 7 0 0 1-14 0v-2 M12 19v4 M8 23h8',
  cpu:     'M8 4h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M12 8v8 M8 12h8',
  sparkle: 'M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5z',
  message:'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  keyboard:'M4 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z M7 13h2 M11 13h2 M15 13h2 M7 17h10',
  palette:'M12 2a10 10 0 1 0 0 20v-3.5a1.5 1.5 0 0 1 1.5-1.5H16a6 6 0 0 0 6-6A6 6 0 0 0 17 3.5 M7 8h.01 M9.5 12.5h.01',
  gear:   'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  clock:  'M12 6v6l4 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z',
  cloud:  'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z',
  edit:   'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z',
  trash:  'M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M10 11v6 M14 11v6',
  plus:   'M12 5v14 M5 12h14',
  check:  'M20 6 9 17l-5-5',
  download:'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
  extlink:'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6 M15 3h6v6 M10 14 21 3',
  cancel: 'M18 6 6 18 M6 6l12 12',
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M2 12h20 M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
};

const SIDEBAR = [
  { key: 'asr',         label: '语音识别',   icon: 'mic' },
  { key: 'llm-model',   label: '优化模型',   icon: 'cpu' },
  { key: 'llm-prompt',  label: '提示词管理', icon: 'sparkle' },
  { key: 'hotkey',      label: '快捷键',     icon: 'keyboard' },
  { key: 'appearance',  label: '外观',       icon: 'palette' },
  { key: 'general',     label: '通用',       icon: 'gear' },
  { key: 'history',     label: '历史',       icon: 'clock' },
];

/* ───────── form defaults ───────── */
const DEFAULT_FORM = {
  tencentASR: { appId: '', secretId: '', secretKey: '', engineType: '16k_zh-PY' as const },
  asr: { provider: 'tencent' as 'tencent' | 'local', localModelId: '', language: 'zh' as 'zh' | 'en' | 'auto', threads: 4 },
  llm: {
    baseURL: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini', systemPrompt: '',
    enableAI: true, prompts: [] as any[], activePromptId: 'builtin-standard', selectedPromptIds: ['builtin-standard'] as string[],
  },
  hotkeys: {
    pushToTalk: 'CommandOrControl+Alt+Z', pushToTalkWithAI: 'CommandOrControl+Alt+X', cancel: 'Escape',
    toggleMode: 'Tab', openSettings: 'CommandOrControl+,', openHistory: 'CommandOrControl+Shift+H',
    confirmInject: 'CommandOrControl+Alt+1', injectPolished: 'Shift+@',
    aiOptimize1: 'Alt+1', aiOptimize2: 'Alt+2', aiOptimize3: 'Alt+3', aiOptimize4: 'Alt+4', aiOptimize5: 'Alt+5',
  },
  appearance: { position: 'center-bottom' as const, opacity: 1, theme: 'light' as const },
  general: { autoLaunch: false, startMinimized: false, injectMode: 'replace' as const },
  history: { enabled: true },
};

type FormData = typeof DEFAULT_FORM;

/* built-in prompt defaults — used by the reset button */
const BUILTIN_DEFAULTS: Record<string, { name: string; description: string; prompt: string }> = {
  'builtin-standard': {
    name: '标准优化',
    description: '去除口语词、修正语病、规范化标点符号',
    prompt: '你是一个文本润色助手。任务：\n1. 去除口语化表达（嗯、那个、就是说、然后、就是、反正、对吧、你知道吗…）\n2. 修正语法错误、错别字\n3. 规范化标点符号（中英文标点统一、增加适当断句）\n4. 保持原意不变，不增删关键信息\n5. 输出简洁清晰的书面中文\n\n直接输出润色后的文本，不要任何解释或前缀。',
  },
  'builtin-formal': {
    name: '正式场景',
    description: '适合邮件、报告、演讲稿等正式场合',
    prompt: '你是一位专业文书编辑。请将用户的口述内容改写为正式书面中文：\n1. 使用正式、得体的用语，避免口语和网络流行语\n2. 结构清晰：如有必要，自动分段\n3. 语气得体：尊敬但不卑微，专业但不生硬\n4. 保持原意，但可适度提升表达的精确度和文采\n5. 修正所有错别字和语法错误\n\n直接输出改写后的文本，不要任何解释或前缀。',
  },
  'builtin-chat': {
    name: '聊天场景',
    description: '适合微信、短信等即时聊天',
    prompt: '你是一位聊天助手。请将用户的口述内容转化为自然、亲切的聊天消息：\n1. 语气轻松自然，像朋友聊天一样\n2. 适当使用表情符号（如 😊、👍、🤔）增加亲和力\n3. 句子简短，适合在手机上阅读\n4. 可以保留一两个自然的口语词让人感觉真实\n5. 修正错别字但不要过于正式\n\n直接输出改写后的文本，不要任何解释或前缀。',
  },
  'builtin-blog': {
    name: '博文场景',
    description: '适合博客、公众号、小红书等平台发布',
    prompt: '你是一位内容创作编辑。请将用户的口述内容改写为适合公开发布的博文：\n1. 增加吸引人的开头，让读者有阅读欲望\n2. 段落短小精悍，每段不超过3-4句话\n3. 适当使用emoji作为视觉分隔符（📌 💡 ✨）\n4. 如有列表项，使用清晰的编号或要点符号\n5. 结尾可加一句互动引导（如"你怎么看？欢迎留言"）\n6. 保持原文事实和信息不变\n\n直接输出改写后的文本，不要任何解释或前缀。',
  },
  'builtin-vibecoding': {
    name: 'vibecoding场景',
    description: '适合描述编程需求、技术文档',
    prompt: '你是一位技术文档工程师。请将用户的口述技术需求整理为清晰的技术说明：\n1. 提取核心需求，去除不必要的闲聊\n2. 使用准确的技术术语，不随意替换专业词汇\n3. 如有技术步骤，按顺序编号或分点列出\n4. 代码相关的描述保持原样，不翻译英文术语\n5. 适当补充上下文（如涉及的框架、语言版本），但用 [待确认] 标注不确定的部分\n6. 格式清晰：合理使用标题、列表、代码块标记\n\n直接输出整理后的技术说明，不要任何解释或前缀。',
  },
  'builtin-lindaiyu': {
    name: '林黛玉语气',
    description: '模仿《红楼梦》林黛玉的口吻风格',
    prompt: '请将用户的文本改写为林黛玉的说话风格：\n1. 语气娇嗔、略带哀怨，透着一股"我见犹怜"的气质\n2. 常用"罢了"、"偏生"、"谁知"、"可不知"、"真真儿的"等林妹妹标志词\n3. 说话委婉，喜欢用反问和自嘲\n4. 偶尔引用诗词或红楼梦中的典故\n5. 不管说什么都带点"怨"的味道，但又不多到让人讨厌\n6. 整体文白夹杂，偏古典白话\n\n直接输出改写后的文本，不要任何解释或前缀。',
  },
};

/* ───────── shared styles ───────── */
const inputCls = 'w-full px-3 py-2.5 bg-white border border-zinc-200 rounded-lg text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900/10 transition-colors';

const btnPrimary  = 'inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium text-white bg-zinc-900 rounded-lg hover:bg-zinc-800 active:bg-zinc-950 transition-colors';
const btnSecondary = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-zinc-600 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 hover:border-zinc-300 transition-colors';
const btnDanger    = 'inline-flex items-center gap-1 px-3 py-1.5 text-[12px] font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50 transition-colors';

export function SettingsPanel() {
  const [form, setForm] = useState<FormData>(DEFAULT_FORM);
  const [activeSection, setActiveSection] = useState('asr');
  const [saved, setSaved] = useState(false);
  const [recordingKey, setRecordingKey] = useState<string | null>(null);
  const [showPromptForm, setShowPromptForm] = useState(false);
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [promptForm, setPromptForm] = useState({ name: '', description: '', prompt: '' });

  useEffect(() => {
    window.voiceflow.getConfig().then((c) => {
      if (c) setForm({
        tencentASR: { ...DEFAULT_FORM.tencentASR, ...c.tencentASR },
        asr: { ...DEFAULT_FORM.asr, ...(c.asr || {}) },
        llm: { ...DEFAULT_FORM.llm, ...c.llm, prompts: c.llm?.prompts?.length ? c.llm.prompts : DEFAULT_FORM.llm.prompts, selectedPromptIds: c.llm?.selectedPromptIds?.length ? c.llm.selectedPromptIds : DEFAULT_FORM.llm.selectedPromptIds },
        hotkeys: { ...DEFAULT_FORM.hotkeys, ...c.hotkeys },
        appearance: { ...DEFAULT_FORM.appearance, ...c.appearance },
        general: { ...DEFAULT_FORM.general, ...c.general },
        history: { ...DEFAULT_FORM.history, ...c.history },
      });
    });
  }, []);

  const update = (path: string, value: any) => {
    setForm((prev) => {
      const next: any = { ...prev };
      const keys = path.split('.');
      let obj: any = next;
      for (let i = 0; i < keys.length - 1; i++) { obj[keys[i]] = { ...obj[keys[i]] }; obj = obj[keys[i]]; }
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

  const handleResetPrompt = (id: string) => {
    const def = BUILTIN_DEFAULTS[id];
    if (!def) return;
    update('llm.prompts', form.llm.prompts.map((p: any) =>
      p.id === id ? { ...p, name: def.name, description: def.description, prompt: def.prompt } : p));
    setPromptForm({ name: def.name, description: def.description, prompt: def.prompt });
  };

  const openPromptEditor = (p: any) => {
    setEditingPromptId(p.id);
    setPromptForm({ name: p.name, description: p.description, prompt: p.prompt });
    setShowPromptForm(true);
  };

  /** 把 Electron accelerator 转成 Windows 用户可读格式 */
  const displayAccel = (s: string) =>
    s
      .replace(/CommandOrControl/g, 'Ctrl')
      .replace(/Control/g, 'Ctrl')
      .replace(/Command/g, '')
      .replace(/\+\+/g, '+')
      .replace(/^\+/, '')
      .replace(/\+$/, '')
      || '未设置';

  useEffect(() => {
    if (!recordingKey) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      const parts: string[] = [];
      if (e.ctrlKey) parts.push('CommandOrControl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      let main = e.key;
      if (main === ' ') main = 'Space';
      if (main.length === 1) main = main.toUpperCase();
      if (main !== 'Control' && main !== 'Alt' && main !== 'Shift' && main !== 'Meta') {
        parts.push(main);
        update(`hotkeys.${recordingKey}`, parts.join('+'));
        setRecordingKey(null);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [recordingKey]);

  return (
    <div className="w-full h-full bg-zinc-50 overflow-y-auto">
      <div className="flex h-full">
        {/* ─── sidebar ─── */}
        <nav className="w-[220px] shrink-0 bg-white border-r border-zinc-200 flex flex-col py-6">
          <div className="px-5 mb-6">
            <div className="text-[15px] font-semibold text-zinc-900">VoiceFlow</div>
            <div className="text-[11px] text-zinc-400 mt-0.5">Settings</div>
          </div>
          {SIDEBAR.map((item) => (
            <button
              key={item.key}
              onClick={() => setActiveSection(item.key)}
              className={`flex items-center gap-2.5 mx-2 px-3 py-2 rounded-md text-[13px] transition-colors text-left ${
                activeSection === item.key
                  ? 'bg-zinc-100 text-zinc-900 font-medium'
                  : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50'
              }`}
            >
              <span className={activeSection === item.key ? 'text-zinc-900' : 'text-zinc-400'}>
                <Icon d={ICONS[item.icon]} size={15} />
              </span>
              {item.label}
            </button>
          ))}
        </nav>

        {/* ─── content ─── */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[620px] mx-auto p-8">
            {/* header */}
            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="text-lg font-semibold text-zinc-900">{SIDEBAR.find(s => s.key === activeSection)?.label}</h1>
                <p className="text-[12px] text-zinc-400 mt-0.5">VoiceFlow settings</p>
              </div>
              <button onClick={handleSave} className={btnPrimary}>
                {saved ? (<><Icon d={ICONS.check} size={14} />已保存</>) : '保存设置'}
              </button>
            </div>

            {/* sections */}
            {activeSection === 'asr' && (
              <Section title="语音识别引擎" desc="选择云端或本地识别方案">
                {/* provider toggle */}
                <Field label="识别引擎">
                  <div className="flex bg-zinc-100 rounded-lg p-0.5 w-fit">
                    {(['tencent', 'local'] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => update('asr.provider', p)}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] rounded-md font-medium transition-colors ${
                          form.asr.provider === p ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                        }`}
                      >
                        <Icon d={p === 'tencent' ? ICONS.cloud : ICONS.cpu} size={14} />
                        {p === 'tencent' ? '腾讯云' : '本地模型'}
                      </button>
                    ))}
                  </div>
                </Field>

                {form.asr.provider === 'tencent' ? (
                  <>
                    <InfoCard>
                      <p className="text-[13px] font-medium text-zinc-800">腾讯云 ASR 新用户免费额度</p>
                      <p className="text-[12px] text-zinc-500 mt-1">每月赠送数小时免费转写额度，足够日常使用</p>
                      <button onClick={() => window.voiceflow.openExternal('https://cloud.tencent.com/product/asr')}
                        className="inline-flex items-center gap-1 mt-2 text-[12px] font-medium text-zinc-900 hover:underline">
                        前往领取 <Icon d={ICONS.extlink} size={12} />
                      </button>
                    </InfoCard>
                    <Field label="AppId"><input className={inputCls} value={form.tencentASR.appId} onChange={(e) => update('tencentASR.appId', e.target.value)} placeholder="1400000000" /></Field>
                    <Field label="SecretId"><input className={inputCls} value={form.tencentASR.secretId} onChange={(e) => update('tencentASR.secretId', e.target.value)} placeholder="AKID..." /></Field>
                    <Field label="SecretKey"><input type="password" className={inputCls} value={form.tencentASR.secretKey} onChange={(e) => update('tencentASR.secretKey', e.target.value)} placeholder="••••••••" /></Field>
                    <Field label="引擎类型">
                      <select className={inputCls} value={form.tencentASR.engineType} onChange={(e) => update('tencentASR.engineType', e.target.value as any)}>
                        <option value="16k_zh">中文 (16k_zh)</option>
                        <option value="16k_zh-PY">中英混合 (16k_zh-PY)</option>
                        <option value="16k_en">英文 (16k_en)</option>
                      </select>
                    </Field>
                    <Tutorial />
                  </>
                ) : (
                  <LocalModelSection form={form} update={update} />
                )}
              </Section>
            )}

            {activeSection === 'llm-model' && (
              <Section title="优化模型" desc="配置 OpenAI 兼容的 LLM 接口">
                <Field label="启用 AI 优化">
                  <Toggle checked={form.llm.enableAI} onChange={(v) => update('llm.enableAI', v)} />
                </Field>
                <Field label="Base URL"><input className={inputCls} value={form.llm.baseURL} onChange={(e) => update('llm.baseURL', e.target.value)} placeholder="https://api.openai.com/v1" /></Field>
                <Field label="API Key"><input type="password" className={inputCls} value={form.llm.apiKey} onChange={(e) => update('llm.apiKey', e.target.value)} placeholder="sk-..." /></Field>
                <Field label="Model"><input className={inputCls} value={form.llm.model} onChange={(e) => update('llm.model', e.target.value)} placeholder="gpt-4o-mini" /></Field>
                <Tip>配置后在提示词管理中选择场景，录制完按 Alt+1~5 即可 AI 优化</Tip>
              </Section>
            )}

            {activeSection === 'llm-prompt' && (
              <Section title="提示词管理" desc="勾选最多 5 个提示词，绑定到 Alt+1 ~ Alt+5 快捷键">
                <div className="space-y-1.5">
                  {(form.llm.prompts || []).map((p: any) => {
                    const selIdx = (form.llm.selectedPromptIds || []).indexOf(p.id);
                    const isSelected = selIdx >= 0;
                    return (
                      <div key={p.id}
                        onClick={() => openPromptEditor(p)}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors cursor-pointer ${
                          isSelected ? 'border-zinc-900/20 bg-zinc-50' : 'border-zinc-200/60 bg-white hover:border-zinc-300'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium text-zinc-900">{p.name}</span>
                            {p.isBuiltin && <span className="text-[10px] px-1.5 py-0.5 bg-zinc-100 text-zinc-500 rounded font-medium">内置</span>}
                            {isSelected && <span className="text-[10px] px-1.5 py-0.5 bg-zinc-900 text-white rounded font-mono">Alt+{selIdx + 1}</span>}
                          </div>
                          <p className="text-[11px] text-zinc-400 truncate mt-0.5">{p.description}</p>
                        </div>
                        <div className="shrink-0 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <button title="编辑" onClick={() => openPromptEditor(p)}
                                className="p-1 rounded hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700"><Icon d={ICONS.edit} size={14} /></button>
                            {!p.isBuiltin && (
                              <button title="删除" onClick={() => {
                                if (!confirm(`删除自定义提示词"${p.name}"？`)) return;
                                const np = form.llm.prompts.filter((x: any) => x.id !== p.id);
                                const ns = (form.llm.selectedPromptIds || []).filter((id: string) => id !== p.id);
                                update('llm.prompts', np); update('llm.selectedPromptIds', ns);
                                if (form.llm.activePromptId === p.id) update('llm.activePromptId', 'builtin-standard');
                              }} className="p-1 rounded hover:bg-red-50 text-zinc-400 hover:text-red-500"><Icon d={ICONS.trash} size={14} /></button>
                            )}
                          {isSelected ? (
                            <button title="解除绑定" onClick={() => {
                              const ids = [...form.llm.selectedPromptIds]; ids.splice(selIdx, 1); update('llm.selectedPromptIds', ids);
                            }} className="w-6 h-6 rounded-full bg-zinc-900 text-white text-[11px] font-bold flex items-center justify-center">{selIdx + 1}</button>
                          ) : (
                            <button title="绑定到下一个空闲快捷键" onClick={() => {
                              const ids = [...(form.llm.selectedPromptIds || [])]; if (ids.length >= 5) return; ids.push(p.id); update('llm.selectedPromptIds', ids);
                            }} disabled={(form.llm.selectedPromptIds || []).length >= 5}
                              className="w-6 h-6 rounded-full border-2 border-zinc-300 text-zinc-300 text-xs flex items-center justify-center hover:border-zinc-900 hover:text-zinc-900 disabled:opacity-30">+</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {(form.llm.selectedPromptIds || []).length > 0 && (
                  <div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-400">
                    <span>绑定顺序：</span>
                    {(form.llm.selectedPromptIds || []).map((id, i) => {
                      const p = (form.llm.prompts || []).find((x: any) => x.id === id);
                      return <span key={id} className="px-2 py-0.5 bg-zinc-100 text-zinc-600 rounded font-mono text-[11px]">Alt+{i + 1} {p?.name || id}</span>;
                    })}
                  </div>
                )}
                <button onClick={() => { setShowPromptForm(true); setEditingPromptId(null); setPromptForm({ name: '', description: '', prompt: '' }); }}
                  className="mt-3 w-full py-2.5 text-[13px] font-medium text-zinc-500 bg-white border-2 border-dashed border-zinc-200 rounded-xl hover:border-zinc-400 hover:text-zinc-700 transition-colors flex items-center justify-center gap-1.5">
                  <Icon d={ICONS.plus} size={14} />新建提示词
                </button>
              </Section>
            )}

            {showPromptForm && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"
                onClick={() => { setShowPromptForm(false); setEditingPromptId(null); }}>
                <div className="bg-white rounded-xl shadow-xl border border-zinc-200 p-6 w-[460px] space-y-4" onClick={(e) => e.stopPropagation()}>
                  <div className="text-[15px] font-semibold text-zinc-900 flex items-center justify-between">
                    <span>{editingPromptId ? '编辑提示词' : '新建提示词'}</span>
                    {editingPromptId && BUILTIN_DEFAULTS[editingPromptId] && (
                      <button onClick={() => handleResetPrompt(editingPromptId!)}
                        className="text-[12px] font-normal text-zinc-400 hover:text-zinc-700 flex items-center gap-1 transition-colors">
                        <Icon d={ICONS.cancel} size={13} /> 重置为默认
                      </button>
                    )}
                  </div>
                  <input className={inputCls} placeholder="名称" value={promptForm.name} onChange={(e) => setPromptForm((f) => ({ ...f, name: e.target.value }))} />
                  <input className={inputCls} placeholder="简短描述" value={promptForm.description} onChange={(e) => setPromptForm((f) => ({ ...f, description: e.target.value }))} />
                  <textarea className={`${inputCls} min-h-[140px] font-mono text-[12px]`} placeholder="System Prompt 全文..."
                    value={promptForm.prompt} onChange={(e) => setPromptForm((f) => ({ ...f, prompt: e.target.value }))} />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => { setShowPromptForm(false); setEditingPromptId(null); }} className={btnSecondary}>取消</button>
                    <button onClick={() => {
                      if (!promptForm.name || !promptForm.prompt) return;
                      if (editingPromptId) {
                        update('llm.prompts', form.llm.prompts.map((p: any) => p.id === editingPromptId ? { ...p, name: promptForm.name, description: promptForm.description, prompt: promptForm.prompt } : p));
                      } else {
                        update('llm.prompts', [...form.llm.prompts, { id: `custom-${Date.now()}`, ...promptForm, isBuiltin: false }]);
                      }
                      setShowPromptForm(false); setEditingPromptId(null); setPromptForm({ name: '', description: '', prompt: '' });
                    }} disabled={!promptForm.name || !promptForm.prompt} className={btnPrimary}>
                      保存
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'hotkey' && (
              <Section title="快捷键" desc="点击任意项，按下新组合键以重新录制">
                {([
                  ['pushToTalk', '推说（普通）'], ['pushToTalkWithAI', '推说（带 AI 优化）'],
                  ['confirmInject', '注入原文'], ['injectPolished', '注入 AI 优化结果'],
                  ['aiOptimize1', 'AI 优化 #1'], ['aiOptimize2', 'AI 优化 #2'], ['aiOptimize3', 'AI 优化 #3'], ['aiOptimize4', 'AI 优化 #4'], ['aiOptimize5', 'AI 优化 #5'],
                  ['cancel', '取消 (Esc)'], ['toggleMode', '切换覆盖/追加模式'],
                  ['openSettings', '打开设置'], ['openHistory', '打开历史'],
                ] as const).map(([key, label]) => (
                  <Field key={key} label={label}>
                    <button onClick={() => setRecordingKey(key)}
                      className={`${inputCls} text-left font-mono text-[13px] ${
                        recordingKey === key ? 'border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900' : ''
                      }`}>
                      {recordingKey === key ? '请按下新快捷键…' : displayAccel(form.hotkeys[key as keyof typeof form.hotkeys] || '')}
                    </button>
                  </Field>
                ))}
                <Tip>Esc 在所有非 idle 状态下可关闭浮窗</Tip>
              </Section>
            )}

            {activeSection === 'appearance' && (
              <Section title="外观" desc="调整浮窗位置、透明度与主题">
                <Field label="浮窗位置">
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['top-left','center-top','top-right','bottom-left','center-bottom','bottom-right'] as const).map((v) => {
                      const labelMap: Record<string,string> = {'top-left':'左上','center-top':'中上','top-right':'右上','bottom-left':'左下','center-bottom':'中下','bottom-right':'右下'};
                      return (
                        <button key={v} onClick={() => update('appearance.position', v)}
                          className={`px-3 py-2 text-[12px] rounded-md border transition-colors ${
                            form.appearance.position === v ? 'border-zinc-900 bg-zinc-900 text-white font-medium' : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300'
                          }`}>{labelMap[v]}</button>
                      );
                    })}
                  </div>
                </Field>
                <Field label={`不透明度 ${Math.round(form.appearance.opacity * 100)}%`}>
                  <input type="range" min="0.1" max="1" step="0.05" value={form.appearance.opacity}
                    onChange={(e) => update('appearance.opacity', parseFloat(e.target.value))}
                    className="w-full accent-zinc-900" />
                </Field>
                <Field label="主题">
                  <select className={inputCls} value={form.appearance.theme} onChange={(e) => update('appearance.theme', e.target.value as any)}>
                    <option value="light">浅色</option><option value="dark">深色</option><option value="system">跟随系统</option>
                  </select>
                </Field>
              </Section>
            )}

            {activeSection === 'general' && (
              <Section title="通用" desc="启动行为与文本注入模式">
                <Field label="开机自启">
                  <Toggle checked={form.general.autoLaunch} onChange={(v) => update('general.autoLaunch', v)} label="Windows 启动时自动运行" />
                </Field>
                <Field label="默认注入模式">
                  <div className="flex bg-zinc-100 rounded-lg p-0.5 w-fit">
                    {(['replace', 'append'] as const).map((m) => (
                      <button key={m} onClick={() => update('general.injectMode', m)}
                        className={`px-4 py-1.5 text-[13px] rounded-md font-medium transition-colors ${
                          form.general.injectMode === m ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                        }`}>{m === 'replace' ? '覆盖' : '追加'}</button>
                    ))}
                  </div>
                </Field>
              </Section>
            )}

            {activeSection === 'history' && (
              <Section title="历史记录" desc="自动保留最近 30 条识别结果">
                <Field label="启用历史记录">
                  <Toggle checked={form.history.enabled} onChange={(v) => update('history.enabled', v)} label="记录每次识别结果" />
                </Field>
                <Tip>关闭后不再写入新记录，已有记录仍会保留</Tip>
              </Section>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

/* ───────── shared components ───────── */

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return <div className="space-y-5">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-2.5 border-b border-zinc-100 last:border-0">
      <label className="w-[130px] shrink-0 text-[13px] text-zinc-500 pt-2">{label}</label>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return <div className="text-[12px] text-zinc-400 px-3 py-2.5 bg-zinc-50 rounded-lg border border-zinc-100">{children}</div>;
}

function InfoCard({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl">{children}</div>;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer">
      <button
        role="switch" aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors ${checked ? 'bg-zinc-900' : 'bg-zinc-200'}`}
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
      {label && <span className="text-[13px] text-zinc-700">{label}</span>}
    </label>
  );
}

function Tutorial() {
  const steps = [
    { label: '注册腾讯云账号并实名认证', url: 'https://cloud.tencent.com/register', linkText: '打开注册页' },
    { label: '开通「语音识别 ASR」服务', url: 'https://console.cloud.tencent.com/asr', linkText: '打开控制台', extra: '首次开通每月赠送数小时免费额度' },
    { label: '创建应用获取密钥', url: 'https://console.cloud.tencent.com/asr/app', linkText: '直接打开应用管理', extra: '控制台 → 语音识别 → 应用管理 → 新建应用 → 复制 AppId / SecretId / SecretKey 填到上方表单' },
  ];
  return (
    <div className="mt-3 px-4 py-4 bg-zinc-50 border border-zinc-200 rounded-xl space-y-3">
      <p className="text-[13px] font-medium text-zinc-800">如何获取腾讯云 ASR 凭证</p>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="shrink-0 w-5 h-5 rounded-full bg-zinc-900 text-white text-[11px] font-medium flex items-center justify-center">{i + 1}</span>
            <div>
              <p className="text-[12px] font-medium text-zinc-800">{s.label}</p>
              {s.extra && <p className="text-[11px] text-zinc-400 mt-0.5">{s.extra}</p>}
              <button onClick={() => window.voiceflow.openExternal(s.url)} className="inline-flex items-center gap-1 text-[11px] text-zinc-600 hover:text-zinc-900 mt-0.5 font-medium">
                {s.linkText} <Icon d={ICONS.extlink} size={10} />
              </button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ───────── local model section ───────── */
function LocalModelSection({ form, update }: { form: FormData; update: (path: string, value: any) => void }) {
  const [models, setModels] = useState<Array<{ id: string; name: string; description: string; sizeBytes: number; downloaded: boolean }>>([]);
  const [progress, setProgress] = useState<Record<string, ModelDownloadProgress>>({});
  const [downloading, setDownloading] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { const list = await window.voiceflow.listModels(); setModels(list); } catch (e) { console.error('listModels failed', e); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    return window.voiceflow.on('model:progress', (p: ModelDownloadProgress) => {
      setProgress((prev) => ({ ...prev, [p.modelId]: p }));
      if (p.state === 'completed' || p.state === 'failed' || p.state === 'cancelled') { setDownloading(null); refresh(); }
    });
  }, [refresh]);

  useEffect(() => {
    const dl = models.filter((m) => m.downloaded);
    if (dl.length > 0 && !dl.find((m) => m.id === form.asr.localModelId)) update('asr.localModelId', dl[0].id);
  }, [models, form.asr.localModelId, update]);

  const download = async (id: string) => { setDownloading(id); try { await window.voiceflow.downloadModel(id); } catch {} };
  const cancel = (id: string) => window.voiceflow.cancelDownload(id);
  const del = async (id: string) => { if (!confirm(`删除模型 ${id}？`)) return; await window.voiceflow.deleteModel(id); refresh(); };

  return (
    <>
      <Tip>本地识别完全离线，不消耗流量，无隐私顾虑。模型越大越准但越慢。</Tip>

      <div className="space-y-1.5">
        {models.map((m) => {
          const prog = progress[m.id];
          const pct = prog && prog.totalBytes > 0 ? Math.floor((prog.bytesDownloaded / prog.totalBytes) * 100) : 0;
          const isDownloading = downloading === m.id && prog?.state !== 'completed' && prog?.state !== 'failed' && prog?.state !== 'cancelled';
          const isSelected = form.asr.localModelId === m.id && m.downloaded;
          return (
            <div key={m.id}
              className={`px-3 py-2.5 rounded-lg border transition-colors ${
                isSelected ? 'border-zinc-900/30 bg-zinc-50' : 'border-zinc-200 bg-white hover:border-zinc-300'
              }`}
            >
              <div className="flex items-center gap-3">
                <button onClick={() => update('asr.localModelId', m.id)} disabled={!m.downloaded}
                  className={`shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${
                    isSelected ? 'border-zinc-900' : 'border-zinc-300'
                  } ${!m.downloaded ? 'opacity-30 cursor-not-allowed' : ''}`}>
                  {isSelected && <span className="w-2 h-2 rounded-full bg-zinc-900" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-zinc-900">{m.name}</div>
                  <div className="text-[11px] text-zinc-400 truncate">{m.description} &middot; {(m.sizeBytes / 1e6).toFixed(0)} MB</div>
                </div>
                {m.downloaded ? (
                  <>
                    <span className="text-[11px] text-zinc-400 font-medium shrink-0">已下载</span>
                    <button onClick={() => del(m.id)} className={btnDanger}>删除</button>
                  </>
                ) : isDownloading ? (
                  <>
                    <span className="text-[11px] text-zinc-500 font-mono shrink-0">{pct}%</span>
                    <button onClick={() => cancel(m.id)} className={btnSecondary}>取消</button>
                  </>
                ) : prog?.state === 'failed' ? (
                  <button onClick={() => download(m.id)} className={btnDanger}>重试</button>
                ) : (
                  <button onClick={() => download(m.id)} className={btnPrimary}>
                    <Icon d={ICONS.download} size={14} />下载
                  </button>
                )}
              </div>
              {isDownloading && (
                <div className="mt-2 h-1 bg-zinc-100 rounded-full overflow-hidden">
                  <div className="h-full bg-zinc-900 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
                </div>
              )}
              {prog?.state === 'failed' && prog.error && (
                <div className="mt-1.5 text-[11px] text-red-500 truncate">{prog.error}</div>
              )}
            </div>
          );
        })}
      </div>

      <Field label="识别语言">
        <select className={inputCls} value={form.asr.language} onChange={(e) => update('asr.language', e.target.value as any)}>
          <option value="zh">中文</option><option value="en">英文</option><option value="auto">自动检测</option>
        </select>
      </Field>
      <Field label="线程数">
        <input type="number" min={1} max={16} className={inputCls} value={form.asr.threads}
          onChange={(e) => update('asr.threads', parseInt(e.target.value) || 4)} />
      </Field>
      <Tip>线程数建议设为 CPU 物理核心数；模型越大越吃 CPU</Tip>
    </>
  );
}
