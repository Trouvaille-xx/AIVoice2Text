// 主/渲染进程共享类型

export type FloatBubbleState =
  | 'idle' // 待命 - 呼吸态
  | 'recording' // 录音中 - 流式识别
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
  aiOptimize: string;
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
