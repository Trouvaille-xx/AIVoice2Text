import { create } from 'zustand';
import type { FloatBubbleState, HotkeyConfig } from '@shared/types';

interface VoiceflowState {
  // 浮窗状态
  bubbleState: FloatBubbleState;
  setBubbleState: (s: FloatBubbleState) => void;

  // 录音
  isRecording: boolean;
  setIsRecording: (v: boolean) => void;
  recordingSeconds: number;
  setRecordingSeconds: (s: number) => void;

  // 流式识别
  partialText: string;
  setPartialText: (t: string) => void;

  // 最终结果
  finalText: string;
  setFinalText: (t: string) => void;

  // AI 优化
  llmOriginal: string;
  setLlmOriginal: (t: string) => void;
  llmPolished: string;
  setLlmPolished: (t: string) => void;

  // 错误
  error: string;
  setError: (e: string) => void;

  // 注入结果
  injectResult: { ok: boolean; message: string; method: string } | null;
  setInjectResult: (r: any) => void;

  // 注入模式
  injectMode: 'replace' | 'append';
  setInjectMode: (m: 'replace' | 'append') => void;

  // 麦克风音量 (RMS)
  micVolume: number;
  setMicVolume: (v: number) => void;

  // 录音设备
  micDevices: MediaDeviceInfo[];
  setMicDevices: (d: MediaDeviceInfo[]) => void;

  // 快捷键配置（从主进程加载）
  hotkeyConfig: HotkeyConfig | null;
  setHotkeyConfig: (c: HotkeyConfig) => void;

  // 当前会话的 ASR provider（用于 transcribing 状态显示正确文案）
  asrProvider: 'local' | 'tencent';
  setAsrProvider: (p: 'local' | 'tencent') => void;
  // 当前 ASR 引擎标签（"☁️ 腾讯云 16k_zh-PY" / "🤖 Whisper Small" 等）
  asrLabel: string;
  setAsrLabel: (l: string) => void;
}

export const useVoiceflowStore = create<VoiceflowState>((set) => ({
  bubbleState: 'idle',
  setBubbleState: (s) => set({ bubbleState: s }),

  isRecording: false,
  setIsRecording: (v) => set({ isRecording: v }),
  recordingSeconds: 0,
  setRecordingSeconds: (s) => set({ recordingSeconds: s }),

  partialText: '',
  setPartialText: (t) => set({ partialText: t }),

  finalText: '',
  setFinalText: (t) => set({ finalText: t }),

  llmOriginal: '',
  setLlmOriginal: (t) => set({ llmOriginal: t }),
  llmPolished: '',
  setLlmPolished: (t) => set({ llmPolished: t }),

  error: '',
  setError: (e) => set({ error: e }),

  injectResult: null,
  setInjectResult: (r) => set({ injectResult: r }),

  injectMode: 'replace',
  setInjectMode: (m) => set({ injectMode: m }),

  micVolume: 0,
  setMicVolume: (v) => set({ micVolume: v }),

  micDevices: [],
  setMicDevices: (d) => set({ micDevices: d }),

  hotkeyConfig: null,
  setHotkeyConfig: (c) => set({ hotkeyConfig: c }),

  asrProvider: 'tencent',
  setAsrProvider: (p) => set({ asrProvider: p }),
  asrLabel: '☁️ 腾讯云',
  setAsrLabel: (l) => set({ asrLabel: l }),
}));
