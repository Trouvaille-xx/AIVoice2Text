import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // 浮窗控制
  moveFloat: (deltaX: number, deltaY: number) => {
    ipcRenderer.send('float:move', { deltaX, deltaY });
  },
  hideFloat: () => ipcRenderer.send('float:hide'),
  getFloatBounds: (): Promise<Electron.Rectangle | null> =>
    ipcRenderer.invoke('float:get-bounds'),

  // 调试日志
  log: (level: string, message: string) => {
    ipcRenderer.send('renderer:log', { level, message });
  },

  // 录音
  startRecording: (useAI = false) => {
    ipcRenderer.send('recording:start', { useAI });
  },
  stopRecording: () => {
    ipcRenderer.send('recording:stop');
  },
  sendAudioFrame: (pcm: Uint8Array) => {
    ipcRenderer.send('asr:audio-frame', pcm);
  },

  // LLM 预览
  confirmInject: (text: string) => {
    ipcRenderer.send('llm:confirm-inject', { text });
  },
  discardLLM: () => {
    ipcRenderer.send('llm:discard');
  },
  requestPolish: (text: string) => {
    ipcRenderer.send('llm:request-polish', { text });
  },
  requestInject: (text: string) => {
    ipcRenderer.send('inject:request', { text });
  },
  discardPreview: () => {
    ipcRenderer.send('preview:discard');
  },

  // 配置
  getConfig: (): Promise<any> => ipcRenderer.invoke('config:get'),
  saveConfig: (config: any): Promise<boolean> =>
    ipcRenderer.invoke('config:save', config),

  // 历史
  listHistory: (): Promise<any[]> => ipcRenderer.invoke('history:list'),
  removeHistory: (id: number): Promise<any[]> =>
    ipcRenderer.invoke('history:remove', id),
  clearHistory: (): Promise<any[]> => ipcRenderer.invoke('history:clear'),
  injectHistory: (id: number): Promise<any> =>
    ipcRenderer.invoke('history:inject', id),

  // 窗口
  openSettings: () => ipcRenderer.send('open:settings'),
  openHistory: () => ipcRenderer.send('open:history'),

  // 事件订阅
  on: (channel: string, handler: (payload: any) => void) => {
    const allowed = [
      'state:change',
      'asr:partial',
      'asr:final',
      'asr:error',
      'inject:result',
      'llm:start',
      'llm:chunk',
      'llm:done',
      'hotkey:toggle-mode',
    ];
    if (!allowed.includes(channel)) return () => {};
    const listener = (_: any, payload: any) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  platform: process.platform,
};

contextBridge.exposeInMainWorld('voiceflow', api);

export type VoiceflowAPI = typeof api;
