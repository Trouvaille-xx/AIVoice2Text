// 主/渲染进程共享类型

export type FloatBubbleState =
  | 'loading' // 启动中 - 初始化引擎/模型
  | 'idle' // 待命 - 呼吸态
  | 'recording' // 录音中 - 流式识别
  | 'transcribing' // 本地引擎转写中（录音已停，等待识别结果）
  | 'processing' // AI 优化中
  | 'preview'; // 预览面板展开

export interface WindowPosition {
  x: number;
  y: number;
}

export interface ASRPartialEvent {
  text: string;
  seq: number;
}

export interface ASRFinalEvent {
  text: string;
  durationMs: number;
}

export interface ASRErrorEvent {
  code: string;
  message: string;
}

export interface HotkeyConfig {
  pushToTalk: string;
  pushToTalkWithAI: string;
  cancel: string;
  toggleMode: string;
  openSettings: string;
  openHistory: string;
  confirmInject: string;
  injectPolished: string;
  aiOptimize1: string;
  aiOptimize2: string;
  aiOptimize3: string;
  aiOptimize4: string;
  aiOptimize5: string;
}

export interface InjectOptions {
  mode: 'replace' | 'append' | 'prepend';
}

export interface HistoryItem {
  id: number;
  text: string;
  polishedText: string | null;
  usedAi: boolean;
  createdAt: number;
}

/** AI 提示词模板 */
export interface PromptTemplate {
  id: string;          // "builtin-standard" | "custom-{timestamp}"
  name: string;        // 显示名称
  description: string; // 简短说明
  prompt: string;      // system prompt 全文
  isBuiltin: boolean;
}

// ============================================================
// 本地 ASR 模型管理
// ============================================================

/** ASR 提供方:'tencent' = 腾讯云 WebSocket,'local' = 本地 whisper.cpp */
export type ASRProvider = 'tencent' | 'local';

/** 内置默认本地模型清单(由代码常量维护,不需要远端拉) */
export interface LocalModelInfo {
  id: string;                    // 'tiny' | 'base' | 'small' | 'medium'
  name: string;                  // 'Tiny' / 'Base' / 'Small' / 'Medium'
  displayName: string;           // 浮窗用:'🤖 Whisper Tiny'
  filename: string;              // 'ggml-tiny.bin'
  sizeBytes: number;             // 预期大小(用于进度计算 + 兜底)
  url: string;                   // HF mirror 完整下载 URL
  description: string;           // 一句话说明,设置页显示
}

export type ModelDownloadState =
  | 'idle'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** 推送到 renderer 的下载进度事件载荷 */
export interface ModelDownloadProgress {
  modelId: string;
  state: ModelDownloadState;
  bytesDownloaded: number;
  totalBytes: number;
  error?: string;
}
