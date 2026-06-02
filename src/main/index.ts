import {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  screen,
  Tray,
  Menu,
  session,
} from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import log from 'electron-log/main';

import { HotkeyManager } from './hotkey';
import { ConfigStore } from './config/store';
import { TencentASRClient } from './asr/tencent-client';
import { LLMClient } from './llm/client';
import { injectText, captureTargetWindow } from './injector/injector';
import { HistoryDB } from './history/db';
import type { InjectOptions } from '@shared/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
log.initialize({ preload: true });
log.info('=== VoiceFlow starting ===');

declare module 'electron' {
  interface App {
    isQuiting?: boolean;
  }
}

// ============================================================
// 全局实例
// ============================================================
let floatWin: BrowserWindow | null = null;
let settingsWin: BrowserWindow | null = null;
let historyWin: BrowserWindow | null = null;
let tray: Tray | null = null;

const config = new ConfigStore();
const history = new HistoryDB();
const hotkey = new HotkeyManager();

// 当前录音状态
let asrClient: TencentASRClient | null = null;
let isRecording = false;
let currentUseAI = false;
let currentFinalText = '';
let currentPartialText = '';

// ============================================================
// 窗口管理
// ============================================================
function getFloatPosition() {
  const display = screen.getPrimaryDisplay();
  const { workAreaSize } = display;
  const width = 400;
  const height = 360;
  const margin = 24;
  const pos = config.get('appearance').position;
  const x =
    pos === 'top-left' || pos === 'bottom-left'
      ? margin
      : workAreaSize.width - width - margin;
  const y =
    pos === 'top-left' || pos === 'top-right'
      ? margin
      : workAreaSize.height - height - margin;
  return { x, y };
}

function createFloatWindow() {
  const { x, y } = getFloatPosition();
  floatWin = new BrowserWindow({
    width: 400,
    height: 360,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    movable: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  floatWin.setAlwaysOnTop(true, 'floating');
  floatWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (process.env.ELECTRON_RENDERER_URL) {
    floatWin.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    floatWin.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  floatWin.once('ready-to-show', () => floatWin?.show());

  floatWin.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      floatWin?.hide();
    }
  });

  floatWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  const display = screen.getPrimaryDisplay();
  settingsWin = new BrowserWindow({
    width: 720,
    height: 720,
    x: Math.floor((display.workAreaSize.width - 720) / 2),
    y: Math.floor((display.workAreaSize.height - 720) / 2),
    title: 'VoiceFlow 设置',
    backgroundColor: '#F8F9FC',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    settingsWin.loadURL(`${process.env.ELECTRON_RENDERER_URL}#/settings`);
  } else {
    settingsWin.loadFile(path.join(__dirname, '../renderer/index.html'), {
      hash: 'settings',
    });
  }
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

function createHistoryWindow() {
  if (historyWin && !historyWin.isDestroyed()) {
    historyWin.show();
    historyWin.focus();
    return;
  }
  const display = screen.getPrimaryDisplay();
  historyWin = new BrowserWindow({
    width: 560,
    height: 720,
    x: Math.floor((display.workAreaSize.width - 560) / 2),
    y: Math.floor((display.workAreaSize.height - 720) / 2),
    title: 'VoiceFlow 历史记录',
    backgroundColor: '#F8F9FC',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    historyWin.loadURL(`${process.env.ELECTRON_RENDERER_URL}#/history`);
  } else {
    historyWin.loadFile(path.join(__dirname, '../renderer/index.html'), {
      hash: 'history',
    });
  }
  historyWin.on('closed', () => {
    historyWin = null;
  });
}

function createTray() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'build', 'tray.png')
    : path.join(__dirname, '../../build', 'tray.png');

  try {
    const { nativeImage } = require('electron');
    tray = new Tray(nativeImage.createFromPath(iconPath));
  } catch {
    const { nativeImage } = require('electron');
    tray = new Tray(nativeImage.createEmpty());
  }

  const menu = Menu.buildFromTemplate([
    {
      label: '显示浮窗',
      click: () => {
        const { x, y } = getFloatPosition();
        floatWin?.setPosition(x, y);
        floatWin?.show();
        floatWin?.focus();
      },
    },
    { type: 'separator' },
    {
      label: '设置',
      click: () => createSettingsWindow(),
    },
    {
      label: '历史记录',
      click: () => createHistoryWindow(),
    },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: config.get('general').autoLaunch,
      click: (item) => {
        config.set('general.autoLaunch', item.checked);
        app.setLoginItemSettings({ openAtLogin: item.checked });
        config.saveAll();
      },
    },
    { type: 'separator' },
    {
      label: '退出 VoiceFlow',
      click: () => {
        app.isQuiting = true;
        app.quit();
      },
    },
  ]);

  tray!.setToolTip('VoiceFlow - 语音输入助手');
  tray!.setContextMenu(menu);

  tray!.on('click', () => {
    if (floatWin?.isVisible()) {
      floatWin.hide();
    } else {
      const { x, y } = getFloatPosition();
      floatWin?.setPosition(x, y);
      floatWin?.show();
    }
  });
}

// ============================================================
// 录音流程
// ============================================================
async function startRecording(useAI: boolean) {
  if (isRecording) return;
  log.info(`[recording] start requested, useAI=${useAI}`);
  const asr = config.get('tencentASR');
  if (!asr.appId || !asr.secretId || !asr.secretKey) {
    log.warn('[recording] missing ASR config');
    sendToFloat('asr:error', {
      code: 'NO_CONFIG',
      message: '请先在设置中配置腾讯云 ASR',
    });
    openSettings();
    return;
  }

  isRecording = true;
  currentUseAI = useAI;
  currentFinalText = '';
  currentPartialText = '';

  // 录音开始前先记录目标窗口（这样注入时能切回去）
  captureTargetWindow();

  // 显示浮窗（不抢焦点，避免破坏目标窗口的焦点）
  if (floatWin && !floatWin.isVisible()) {
    const { x, y } = getFloatPosition();
    floatWin.setPosition(x, y);
    floatWin.show();
    // 不调用 focus()，让目标窗口保持焦点
  }

  sendToFloat('state:change', 'recording');

  try {
    asrClient = new TencentASRClient({
      appId: asr.appId,
      secretId: asr.secretId,
      secretKey: asr.secretKey,
      engineType: asr.engineType,
    });

    asrClient.on('partial', (r) => {
      log.info(`[recording] partial: "${r.text}"`);
      currentPartialText = r.text;
      sendToFloat('asr:partial', r);
    });

    asrClient.on('final', (r) => {
      log.info(`[recording] FINAL: "${r.text}"`);
      currentFinalText = r.text;
      sendToFloat('asr:final', r);
      onRecordingDone();
    });

    asrClient.on('sentence_end', () => {
      // 腾讯云 VAD 检测到一段话结束
      log.info('[recording] sentence_end (VAD)');
      if (isRecording) {
        // 延迟 500ms 让 final 事件先到
        setTimeout(() => {
          if (isRecording) {
            log.info('[recording] auto-stop after sentence_end');
            stopRecording();
          }
        }, 500);
      }
    });

    asrClient.on('error', (e) => {
      log.error('[recording] ASR error', e);
      sendToFloat('asr:error', e);
    });

    asrClient.on('close', () => {
      log.info('[recording] ASR closed');
    });

    log.info('[recording] ASR starting...');
    await asrClient.start();
    log.info('[recording] ASR ready, waiting for audio');
  } catch (e: any) {
    log.error('[recording] start failed', e);
    sendToFloat('asr:error', {
      code: 'START_FAILED',
      message: e.message || '启动识别失败',
    });
    isRecording = false;
    sendToFloat('state:change', 'idle');
  }
}

async function stopRecording() {
  if (!isRecording || !asrClient) return;
  isRecording = false;
  try {
    await asrClient.stop();
  } catch (e) {
    log.error('[recording] stop error', e);
  }
  asrClient = null;
}

async function onRecordingDone() {
  const text = currentFinalText;
  if (!text) {
    sendToFloat('state:change', 'idle');
    return;
  }

  // 1. 写历史
  if (config.get('history').enabled) {
    try {
      history.add({
        text,
        polishedText: null,
        usedAi: false,
      });
    } catch (e) {
      log.error('[history] add failed', e);
    }
  }

  // 2. 进入 preview 状态，让用户选择"直接注入"或"AI 优化"
  // 不再自动注入，让用户主动选
  sendToFloat('state:change', 'preview');
  sendToFloat('llm:start', { original: text });
}

async function polishAndInject(text: string) {
  const llm = config.get('llm');
  if (!llm.apiKey) {
    sendToFloat('asr:error', {
      code: 'NO_LLM_CONFIG',
      message: '请先在设置中配置 LLM API Key',
    });
    // 降级：直接注入原文
    const result = await injectText(text, {
      mode: config.get('general').injectMode,
    });
    sendToFloat('inject:result', result);
    setTimeout(() => {
      sendToFloat('state:change', 'idle');
      floatWin?.hide();
    }, 1500);
    return;
  }

  let polished = '';
  try {
    const client = new LLMClient({
      baseURL: llm.baseURL,
      apiKey: llm.apiKey,
      model: llm.model,
      systemPrompt: llm.systemPrompt,
    });
    sendToFloat('state:change', 'preview');
    sendToFloat('llm:start', { original: text });
    for await (const chunk of client.polishStream(text)) {
      polished += chunk;
      sendToFloat('llm:chunk', { text: polished });
    }
    sendToFloat('llm:done', { text: polished });
  } catch (e: any) {
    log.error('[polish] error', e);
    sendToFloat('asr:error', {
      code: 'LLM_FAILED',
      message: e.message || 'AI 优化失败',
    });
  }
}

// ============================================================
// IPC
// ============================================================
function sendToFloat(channel: string, payload?: any) {
  if (floatWin && !floatWin.isDestroyed()) {
    floatWin.webContents.send(channel, payload);
  }
}

function openSettings() {
  createSettingsWindow();
}

ipcMain.on('float:move', (_e, { deltaX, deltaY }) => {
  if (!floatWin) return;
  const [x, y] = floatWin.getPosition();
  floatWin.setPosition(x + deltaX, y + deltaY);
});

ipcMain.on('float:hide', () => floatWin?.hide());

ipcMain.handle('float:get-bounds', () => floatWin?.getBounds() ?? null);

// 录音控制（来自浮窗内点击 / 调试用）
ipcMain.on('recording:start', (_e, { useAI }: { useAI: boolean }) =>
  startRecording(useAI)
);
ipcMain.on('recording:stop', () => stopRecording());

// 音频帧统计
let audioFrameCount = 0;
let lastFrameLog = Date.now();

ipcMain.on('asr:audio-frame', (_e, pcm: Uint8Array) => {
  if (asrClient && isRecording) {
    audioFrameCount++;
    asrClient.sendAudio(Buffer.from(pcm));
    // 每 50 帧或每秒打一次日志
    const now = Date.now();
    if (now - lastFrameLog > 1000) {
      log.info(`[audio] received ${audioFrameCount} frames, last size=${pcm.byteLength}`);
      lastFrameLog = now;
      audioFrameCount = 0;
    }
  }
});

// 渲染进程日志转发
ipcMain.on('renderer:log', (_e, { level, message }: { level: string; message: string }) => {
  if (level === 'error') log.error(`[renderer] ${message}`);
  else if (level === 'warn') log.warn(`[renderer] ${message}`);
  else log.info(`[renderer] ${message}`);
});

// LLM 优化结果处理
ipcMain.on('llm:confirm-inject', async (_e, { text }: { text: string }) => {
  if (!text) return;
  const result = await injectText(text, {
    mode: config.get('general').injectMode,
  });
  sendToFloat('inject:result', result);
  // 更新历史的 polished 字段
  setTimeout(() => {
    sendToFloat('state:change', 'idle');
    floatWin?.hide();
  }, 1200);
});

ipcMain.on('llm:discard', () => {
  sendToFloat('state:change', 'idle');
  setTimeout(() => floatWin?.hide(), 400);
});

ipcMain.on('llm:edit', () => {
  // 暂不实现编辑
});

// 用户主动请求 AI 优化
ipcMain.on('llm:request-polish', async (_e, { text }: { text: string }) => {
  if (!text) return;
  const llm = config.get('llm');
  if (!llm.apiKey) {
    sendToFloat('asr:error', {
      code: 'NO_LLM_CONFIG',
      message: '请先在设置中配置 LLM API Key',
    });
    return;
  }
  sendToFloat('state:change', 'processing');
  try {
    const client = new LLMClient({
      baseURL: llm.baseURL,
      apiKey: llm.apiKey,
      model: llm.model,
      systemPrompt: llm.systemPrompt,
    });
    let polished = '';
    for await (const chunk of client.polishStream(text)) {
      polished += chunk;
      sendToFloat('llm:chunk', { text: polished });
    }
    sendToFloat('llm:done', { text: polished });
    sendToFloat('state:change', 'preview');
    // 更新历史
    if (config.get('history').enabled) {
      try {
        history.add({
          text,
          polishedText: polished,
          usedAi: true,
        });
      } catch {}
    }
  } catch (e: any) {
    log.error('[polish] error', e);
    sendToFloat('asr:error', {
      code: 'LLM_FAILED',
      message: e.message || 'AI 优化失败',
    });
    sendToFloat('state:change', 'preview');
  }
});

// 用户主动直接注入（不调 AI）
ipcMain.on('inject:request', async (_e, { text }: { text: string }) => {
  if (!text) return;
  const result = await injectText(text, {
    mode: config.get('general').injectMode,
  });
  sendToFloat('inject:result', result);
  setTimeout(() => {
    sendToFloat('state:change', 'idle');
    floatWin?.hide();
  }, 1200);
});

// 用户丢弃本次结果
ipcMain.on('preview:discard', () => {
  sendToFloat('state:change', 'idle');
  setTimeout(() => floatWin?.hide(), 300);
});

// 配置
ipcMain.handle('config:get', () => config.getAll());
ipcMain.handle('config:save', async (_e, newConfig) => {
  for (const k of Object.keys(newConfig)) {
    config.set(k as any, newConfig[k]);
  }
  await config.saveAll();
  // 更新快捷键
  hotkey.updateConfig(config.get('hotkeys'));
  hotkey.register();
  return true;
});

// 历史
ipcMain.handle('history:list', () => history.list());
ipcMain.handle('history:remove', (_e, id: number) => {
  history.remove(id);
  return history.list();
});
ipcMain.handle('history:clear', () => {
  history.clear();
  return [];
});
ipcMain.handle('history:inject', async (_e, id: number) => {
  const items = history.list(100);
  const item = items.find((i) => i.id === id);
  if (!item) return { ok: false, message: '记录不存在' };
  const text = item.polishedText || item.text;
  return await injectText(text, {
    mode: config.get('general').injectMode,
  });
});

// 打开设置窗口
ipcMain.on('open:settings', () => openSettings());
ipcMain.on('open:history', () => createHistoryWindow());

// ============================================================
// 快捷键回调
// ============================================================
// 长按防抖：避免 OS 自动重复发送 keydown 触发 N 次 toggle
let lastHotkeyTime = 0;
const HOTKEY_DEBOUNCE_MS = 1000;
// 最短录音时长：小于这个不响应 stop（避免 OS 自动重复误触发）
let recordingStartedAt = 0;
const MIN_RECORDING_MS = 1500;

hotkey.setHandler(async (action) => {
  const now = Date.now();
  if (action === 'push-to-talk' || action === 'push-to-talk-with-ai') {
    if (now - lastHotkeyTime < HOTKEY_DEBOUNCE_MS) {
      log.info(`[hotkey] ${action} debounced (${now - lastHotkeyTime}ms)`);
      return;
    }
    lastHotkeyTime = now;
  }
  switch (action) {
    case 'push-to-talk':
      if (isRecording) {
        // 必须在最短录音时长之后才允许 stop
        const recDuration = now - recordingStartedAt;
        if (recDuration < MIN_RECORDING_MS) {
          log.info(`[hotkey] stop ignored, too short (${recDuration}ms < ${MIN_RECORDING_MS}ms)`);
          return;
        }
        log.info('[hotkey] push-to-talk: stop');
        stopRecording();
      } else {
        log.info('[hotkey] push-to-talk: start');
        recordingStartedAt = now;
        startRecording(false);
      }
      break;
    case 'push-to-talk-with-ai':
      if (isRecording) {
        const recDuration = now - recordingStartedAt;
        if (recDuration < MIN_RECORDING_MS) {
          log.info(`[hotkey] stop ignored, too short (${recDuration}ms < ${MIN_RECORDING_MS}ms)`);
          return;
        }
        stopRecording();
      } else {
        recordingStartedAt = now;
        startRecording(true);
      }
      break;
    case 'cancel':
      // Esc 取消
      if (currentFinalText) {
        // 在 preview 状态下按 Esc = 丢弃
        sendToFloat('state:change', 'idle');
        currentFinalText = '';
        currentPartialText = '';
        floatWin?.hide();
      } else {
        stopRecording();
        sendToFloat('state:change', 'idle');
        floatWin?.hide();
      }
      break;
    case 'confirm-inject':
      // 快捷键：注入原文
      if (currentFinalText) {
        log.info('[hotkey] confirm-inject: original');
        const result = await injectText(currentFinalText, {
          mode: config.get('general').injectMode,
        });
        sendToFloat('inject:result', result);
        setTimeout(() => {
          sendToFloat('state:change', 'idle');
          currentFinalText = '';
          floatWin?.hide();
        }, 1000);
      }
      break;
    case 'ai-optimize':
      // 快捷键：AI 优化
      if (currentFinalText) {
        log.info('[hotkey] ai-optimize: requesting polish');
        const llm = config.get('llm');
        if (!llm.apiKey) {
          sendToFloat('asr:error', {
            code: 'NO_LLM_CONFIG',
            message: '请先在设置中配置 LLM API Key',
          });
          return;
        }
        sendToFloat('state:change', 'processing');
        try {
          const client = new LLMClient({
            baseURL: llm.baseURL,
            apiKey: llm.apiKey,
            model: llm.model,
            systemPrompt: llm.systemPrompt,
          });
          let polished = '';
          for await (const chunk of client.polishStream(currentFinalText)) {
            polished += chunk;
            sendToFloat('llm:chunk', { text: polished });
          }
          sendToFloat('llm:done', { text: polished });
          // 优化完成后自动注入
          const result = await injectText(polished, {
            mode: config.get('general').injectMode,
          });
          sendToFloat('inject:result', result);
          setTimeout(() => {
            sendToFloat('state:change', 'idle');
            currentFinalText = '';
            floatWin?.hide();
          }, 1500);
        } catch (e: any) {
          log.error('[polish] error', e);
          sendToFloat('asr:error', {
            code: 'LLM_FAILED',
            message: e.message || 'AI 优化失败',
          });
        }
      }
      break;
    case 'toggle-mode':
      sendToFloat('hotkey:toggle-mode', null);
      break;
    case 'open-settings':
      openSettings();
      break;
    case 'open-history':
      createHistoryWindow();
      break;
  }
});

// ============================================================
// App lifecycle
// ============================================================

// 授予所有 webContents 麦克风权限（Electron 默认拒绝）
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      log.info(`[permission] requested: ${permission}`);
      if (permission === 'media' || permission === 'audioCapture' || permission === 'microphone') {
        return callback(true);
      }
      return callback(false);
    }
  );

  // 设备选择：直接通过（如果有选择器弹窗）
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission) => {
      if (permission === 'media' || permission === 'audioCapture' || permission === 'microphone') {
        return true;
      }
      return false;
    }
  );
});

app.whenReady().then(async () => {
  await config.load();

  // 同步开机自启设置
  app.setLoginItemSettings({
    openAtLogin: config.get('general').autoLaunch,
  });

  createFloatWindow();
  createTray();

  // 注册快捷键
  const { ok, failed } = hotkey.register();
  if (failed.length) {
    log.warn(`Hotkey failed: ${failed.join(', ')}`);
  }
  log.info(`Hotkey ok: ${ok.join(', ')}`);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createFloatWindow();
    }
  });
});

app.on('before-quit', () => {
  app.isQuiting = true;
  history.close();
  hotkey.unregister();
});
