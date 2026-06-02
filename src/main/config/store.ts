/**
 * 配置存储
 * - 公开配置存普通 JSON
 * - 敏感字段（API Key 等）走 electron safeStorage 加密
 */
import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import log from 'electron-log/main';
import type { HotkeyConfig, InjectOptions } from '@shared/types';

export interface AppConfig {
  // 腾讯 ASR
  tencentASR: {
    appId: string;
    secretId: string;
    secretKey: string;
    engineType: '16k_zh' | '16k_zh-PY' | '16k_en';
  };
  // LLM
  llm: {
    baseURL: string;
    apiKey: string;
    model: string;
    systemPrompt: string;
    enableAI: boolean;
  };
  // 快捷键
  hotkeys: HotkeyConfig;
  // 外观
  appearance: {
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
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
  llm: {
    baseURL: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    systemPrompt:
      '你是一个文本润色助手。任务：\n1. 去除口语化表达（嗯、那个、就是说、然后…）\n2. 修正语法错误、错别字\n3. 规范化标点符号\n4. 保持原意不变，不增删关键信息\n5. 输出简洁清晰的书面中文\n\n直接输出润色后的文本，不要任何解释或前缀。',
    enableAI: true,
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
    position: 'bottom-right',
    opacity: 1,
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
    } catch (e) {
      // 不存在则用默认
      log.info('Config file not found, using defaults');
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
