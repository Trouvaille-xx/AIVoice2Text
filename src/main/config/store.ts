/**
 * 配置存储
 * - 公开配置存普通 JSON
 * - 敏感字段（API Key 等）走 electron safeStorage 加密
 */
import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import log from 'electron-log/main';
import type { ASRProvider, HotkeyConfig, InjectOptions, PromptTemplate } from '@shared/types';

export interface AppConfig {
  // 腾讯 ASR
  tencentASR: {
    appId: string;
    secretId: string;
    secretKey: string;
    engineType: '16k_zh' | '16k_zh-PY' | '16k_en';
  };
  // ASR 提供方 + 本地模型配置
  asr: {
    provider: ASRProvider;             // 'tencent' | 'local'
    localModelId: string;              // 'tiny' | 'base' | 'small' | 'medium',空=未选
    language: 'zh' | 'en' | 'auto';
    threads: number;                   // whisper 线程数
  };
  // LLM
  llm: {
    baseURL: string;
    apiKey: string;
    model: string;
    systemPrompt: string;
    enableAI: boolean;
    prompts: PromptTemplate[];
    activePromptId: string;
    selectedPromptIds: string[];  // 快捷键绑定的提示词（最多5个）
  };
  // 快捷键
  hotkeys: HotkeyConfig;
  // 外观
  appearance: {
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center-top' | 'center-bottom';
    opacity: number;
    theme: 'light' | 'dark' | 'system';
  };
  // 通用
  general: {
    autoLaunch: boolean;
    startMinimized: boolean;
    injectMode: InjectOptions['mode'];
  };
  // 历史
  history: {
    enabled: boolean;
  };
}

const DEFAULTS: AppConfig = {
  tencentASR: {
    appId: '',
    secretId: '',
    secretKey: '',
    engineType: '16k_zh-PY',
  },
  asr: {
    provider: 'tencent',   // 兼容老用户,默认仍走云端
    localModelId: '',      // 空=未选(设置页下载后会自动选)
    language: 'zh',
    threads: 4,
  },
  llm: {
    baseURL: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    systemPrompt:
      '你是一个文本润色助手。任务：\n1. 去除口语化表达（嗯、那个、就是说、然后…）\n2. 修正语法错误、错别字\n3. 规范化标点符号\n4. 保持原意不变，不增删关键信息\n5. 输出简洁清晰的书面中文\n\n直接输出润色后的文本，不要任何解释或前缀。',
    enableAI: true,
    prompts: [],
    activePromptId: 'builtin-standard',
    selectedPromptIds: ['builtin-standard'],
  },
  hotkeys: {
    pushToTalk: 'CommandOrControl+Alt+Z',
    pushToTalkWithAI: 'CommandOrControl+Alt+X',
    cancel: 'Escape',
    toggleMode: 'Tab',
    openSettings: 'CommandOrControl+,',
    openHistory: 'CommandOrControl+Shift+H',
    confirmInject: 'CommandOrControl+Alt+1',
    aiOptimize: 'CommandOrControl+Alt+2',
  },
  appearance: {
    position: 'center-bottom',
    opacity: 0.8,
    theme: 'light',
  },
  general: {
    autoLaunch: false,
    startMinimized: false,
    injectMode: 'replace',
  },
  history: {
    enabled: true,
  },
};

const CONFIG_FILE = 'config.json';
const SECRETS_FILE = 'secrets.json';

/** 6 个内置提示词 */
function getBuiltinPrompts(): PromptTemplate[] {
  return [
    {
      id: 'builtin-standard',
      name: '标准优化',
      description: '去除口语词、修正语病、规范化标点符号',
      prompt:
        '你是一个文本润色助手。任务：\n1. 去除口语化表达（嗯、那个、就是说、然后、就是、反正、对吧、你知道吗…）\n2. 修正语法错误、错别字\n3. 规范化标点符号（中英文标点统一、增加适当断句）\n4. 保持原意不变，不增删关键信息\n5. 输出简洁清晰的书面中文\n\n直接输出润色后的文本，不要任何解释或前缀。',
      isBuiltin: true,
    },
    {
      id: 'builtin-formal',
      name: '正式场景',
      description: '适合邮件、报告、演讲稿等正式场合',
      prompt:
        '你是一位专业文书编辑。请将用户的口述内容改写为正式书面中文：\n1. 使用正式、得体的用语，避免口语和网络流行语\n2. 结构清晰：如有必要，自动分段\n3. 语气得体：尊敬但不卑微，专业但不生硬\n4. 保持原意，但可适度提升表达的精确度和文采\n5. 修正所有错别字和语法错误\n\n直接输出改写后的文本，不要任何解释或前缀。',
      isBuiltin: true,
    },
    {
      id: 'builtin-chat',
      name: '聊天场景',
      description: '适合微信、短信等即时聊天',
      prompt:
        '你是一位聊天助手。请将用户的口述内容转化为自然、亲切的聊天消息：\n1. 语气轻松自然，像朋友聊天一样\n2. 适当使用表情符号（如 😊、👍、🤔）增加亲和力\n3. 句子简短，适合在手机上阅读\n4. 可以保留一两个自然的口语词让人感觉真实\n5. 修正错别字但不要过于正式\n\n直接输出改写后的文本，不要任何解释或前缀。',
      isBuiltin: true,
    },
    {
      id: 'builtin-blog',
      name: '博文场景',
      description: '适合博客、公众号、小红书等平台发布',
      prompt:
        '你是一位内容创作编辑。请将用户的口述内容改写为适合公开发布的博文：\n1. 增加吸引人的开头，让读者有阅读欲望\n2. 段落短小精悍，每段不超过3-4句话\n3. 适当使用emoji作为视觉分隔符（📌 💡 ✨）\n4. 如有列表项，使用清晰的编号或要点符号\n5. 结尾可加一句互动引导（如"你怎么看？欢迎留言"）\n6. 保持原文事实和信息不变\n\n直接输出改写后的文本，不要任何解释或前缀。',
      isBuiltin: true,
    },
    {
      id: 'builtin-vibecoding',
      name: 'vibecoding场景',
      description: '适合描述编程需求、技术文档',
      prompt:
        '你是一位技术文档工程师。请将用户的口述技术需求整理为清晰的技术说明：\n1. 提取核心需求，去除不必要的闲聊\n2. 使用准确的技术术语，不随意替换专业词汇\n3. 如有技术步骤，按顺序编号或分点列出\n4. 代码相关的描述保持原样，不翻译英文术语\n5. 适当补充上下文（如涉及的框架、语言版本），但用 [待确认] 标注不确定的部分\n6. 格式清晰：合理使用标题、列表、代码块标记\n\n直接输出整理后的技术说明，不要任何解释或前缀。',
      isBuiltin: true,
    },
    {
      id: 'builtin-lindaiyu',
      name: '林黛玉语气',
      description: '模仿《红楼梦》林黛玉的口吻风格',
      prompt:
        '请将用户的文本改写为林黛玉的说话风格：\n1. 语气娇嗔、略带哀怨，透着一股"我见犹怜"的气质\n2. 常用"罢了"、"偏生"、"谁知"、"可不知"、"真真儿的"等林妹妹标志词\n3. 说话委婉，喜欢用反问和自嘲\n4. 偶尔引用诗词或红楼梦中的典故\n5. 不管说什么都带点"怨"的味道，但又不多到让人讨厌\n6. 整体文白夹杂，偏古典白话\n\n直接输出改写后的文本，不要任何解释或前缀。',
      isBuiltin: true,
    },
  ];
}

function deepClone<T>(o: T): T {
  return JSON.parse(JSON.stringify(o));
}

export class ConfigStore {
  private configPath: string;
  private secretsPath: string;
  private data: AppConfig;
  private secrets: Record<string, string> = {};

  constructor() {
    this.configPath = path.join(app.getPath('userData'), CONFIG_FILE);
    this.secretsPath = path.join(app.getPath('userData'), SECRETS_FILE);
    this.data = deepClone(DEFAULTS);
  }

  async load() {
    // 读公开配置
    try {
      const buf = await fs.readFile(this.configPath, 'utf-8');
      this.data = { ...deepClone(DEFAULTS), ...JSON.parse(buf) };
      // 迁移：确保 prompts 数组存在
      if (!this.data.llm.prompts || this.data.llm.prompts.length === 0) {
        this.data.llm.prompts = getBuiltinPrompts();
        log.info('Config migrated: prompts populated with builtins');
      }
      if (!this.data.llm.activePromptId) {
        this.data.llm.activePromptId = 'builtin-standard';
      }
      if (!this.data.llm.selectedPromptIds || this.data.llm.selectedPromptIds.length === 0) {
        this.data.llm.selectedPromptIds = ['builtin-standard'];
      }
      // 迁移: 老 config 没 asr 段,补默认(深度合并,保 user 已设的字段)
      if (!this.data.asr) {
        this.data.asr = deepClone(DEFAULTS.asr);
        log.info('Config migrated: asr section added with defaults');
      } else {
        this.data.asr = { ...deepClone(DEFAULTS.asr), ...this.data.asr };
      }
    } catch (e) {
      // 不存在则用默认
      log.info('Config file not found, using defaults');
      // 首次运行：注入内置提示词
      this.data.llm.prompts = getBuiltinPrompts();
      this.data.llm.activePromptId = 'builtin-standard';
      this.data.llm.selectedPromptIds = ['builtin-standard'];
    }

    // 读 secrets（加密）
    try {
      const buf = await fs.readFile(this.secretsPath, 'utf-8');
      const enc = JSON.parse(buf) as Record<string, string>;
      if (safeStorage.isEncryptionAvailable()) {
        for (const [k, v] of Object.entries(enc)) {
          try {
            this.secrets[k] = safeStorage.decryptString(Buffer.from(v, 'base64'));
          } catch (e) {
            log.warn(`Failed to decrypt secret: ${k}`);
          }
        }
      } else {
        log.warn('safeStorage not available, secrets not decrypted');
      }
    } catch {
      // 没有 secrets 文件
    }
  }

  async save() {
    await fs.writeFile(this.configPath, JSON.stringify(this.data, null, 2), 'utf-8');
    // 加密 secrets
    if (safeStorage.isEncryptionAvailable()) {
      const enc: Record<string, string> = {};
      for (const [k, v] of Object.entries(this.secrets)) {
        enc[k] = safeStorage.encryptString(v).toString('base64');
      }
      await fs.writeFile(this.secretsPath, JSON.stringify(enc, null, 2), 'utf-8');
    }
  }

  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.data[key];
  }

  getAll(): AppConfig {
    return deepClone(this.data);
  }

  set<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    this.data[key] = value;
  }

  getSecret(key: string): string {
    return this.secrets[key] || '';
  }

  setSecret(key: string, value: string) {
    this.secrets[key] = value;
  }

  async saveAll() {
    await this.save();
  }
}
