import {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  screen,
  Tray,
  Menu,
  session,
  Notification,
} from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import log from 'electron-log/main';

import { HotkeyManager } from './hotkey';
import { ConfigStore } from './config/store';
import { TencentASRClient } from './asr/tencent-client';
import { LocalASRClient } from './asr/local-client';
import { EnergyVAD } from './asr/vad';
import { LLMClient } from './llm/client';
import { injectText, captureTargetWindow, getForegroundHwnd, setFallbackTargetHwnd } from './injector/injector';
import { HistoryDB } from './history/db';
import { ModelManager, BUILTIN_MODELS } from './models/manager';
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
const modelManager = new ModelManager();

// 当前浮窗状态（用于动态快捷键管理）
let currentFloatState = 'idle';

// 追踪用户最后使用的非浮窗前台窗口（用于点击浮窗启动录音时找回目标）
let lastUserForegroundHwnd: number | null = null;

// 当前录音状态
let asrClient: TencentASRClient | LocalASRClient | null = null;
let isRecording = false;
// 会话计数器：每次 startRecording 自增。listener 用闭包捕获 thisSession，
// 回调里比对 currentSession，避免"force-kill 旧 client"或"新 session 开始"后
// 旧 session 的延迟事件（Tencent 'final' 461ms 后才到）被误判为 stale。
let currentSession = 0;
let currentUseAI = false;
let currentFinalText = '';
let currentPolishedText = '';
let currentPartialText = '';

// ============================================================
// 窗口管理
// ============================================================
function getFloatPosition() {
  const display = screen.getPrimaryDisplay();
  const { workAreaSize } = display;
  const width = 520;
  const height = Math.min(140, workAreaSize.height - 48);
  const margin = 24;
  const pos = config.get('appearance').position;

  let x: number;
  if (pos === 'top-left' || pos === 'bottom-left') {
    x = margin;
  } else if (pos === 'top-right' || pos === 'bottom-right') {
    x = workAreaSize.width - width - margin;
  } else {
    // center-top, center-bottom: 水平居中
    x = Math.floor((workAreaSize.width - width) / 2);
  }

  let y: number;
  if (pos === 'top-left' || pos === 'top-right' || pos === 'center-top') {
    y = margin;
  } else {
    // bottom-left, bottom-right, center-bottom
    y = workAreaSize.height - height - margin;
  }

  log.info(`[pos] getFloatPosition: appearance.position=${pos} screen=${workAreaSize.width}x${workAreaSize.height} → (${x}, ${y})`);
  return { x, y };
}

function createFloatWindow() {
  const { x, y } = getFloatPosition();
  log.info(`[window] creating float at (${x}, ${y})`);
  floatWin = new BrowserWindow({
    width: 520,
    height: Math.min(160, screen.getPrimaryDisplay().workAreaSize.height - 48),
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    movable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  try { floatWin.setIcon(getIconPath()); } catch {}

  floatWin.setAlwaysOnTop(true, 'floating');
  floatWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // 应用不透明度（OS 窗口级别 + CSS 变量）
  const opacity = config.get('appearance').opacity;
  floatWin.setOpacity(opacity);
  floatWin.webContents.on('did-finish-load', () => {
    floatWin?.webContents.executeJavaScript(`document.body.style.setProperty('--opacity', '${opacity}')`);
  });

  // 日志：页面加载失败
  floatWin.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log.error(`[window] float failed to load: ${url} code=${code} desc=${desc}`);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    log.info(`[window] float loading dev URL: ${process.env.ELECTRON_RENDERER_URL}`);
    floatWin.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    const htmlPath = path.join(__dirname, '../renderer/index.html');
    log.info(`[window] float loading file: ${htmlPath}`);
    floatWin.loadFile(htmlPath);
  }

  floatWin.once('ready-to-show', () => {
    log.info('[window] float ready-to-show');
    floatWin?.show();
    log.info(`[window] float shown, visible=${floatWin?.isVisible()}`);
  });

  floatWin.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      hideFloatWindow();
    }
  });

  floatWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/** 获取图标路径（开发/生产环境自适应） */
function getIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, '../../build', 'icon.ico');
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
    try { settingsWin.setIcon(getIconPath()); } catch {}
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
  try { historyWin.setIcon(getIconPath()); } catch {}
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
    ? path.join(process.resourcesPath, 'tray.png')
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
        const [oldX, oldY] = floatWin?.getPosition() ?? [0, 0];
        const [oldW, oldH] = floatWin?.getSize() ?? [0, 0];
        log.info(`[tray] show float: old=(${oldX},${oldY}) ${oldW}x${oldH} → (${x},${y})`);
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
  // 关键：递增会话计数器，旧的 listener 立刻被识别为 stale
  currentSession++;
  // 若上一个转写（LocalASRClient 处于 stop 等待 whisper 退出）还在跑，先杀掉
  if (asrClient && typeof (asrClient as any).forceKill === 'function') {
    log.info('[recording] killing previous transcription in progress');
    (asrClient as any).forceKill();
    try { await asrClient.stop(); } catch {}
    asrClient = null;
  }
  log.info(`[recording] start requested, useAI=${useAI}`);

  // ────────────── 选择 provider ──────────────
  const asrCfg = config.get('asr');
  const provider = asrCfg?.provider || 'tencent';

  // 录音前记录目标窗口（点击浮窗会抢焦点，传 hwnd 以便回退到用户窗口）
  let floatHwnd: number | undefined;
  try {
    const buf = floatWin?.getNativeWindowHandle();
    if (buf) floatHwnd = buf.readInt32LE(0);
  } catch {}
  captureTargetWindow(floatHwnd);

  // 浮窗 show
  if (floatWin) {
    const { x, y } = getFloatPosition();
    const h = Math.min(140, screen.getPrimaryDisplay().workAreaSize.height - 48);
    const wasVisible = floatWin.isVisible();
    const [oldX, oldY] = floatWin.getPosition();
    const [oldW, oldH] = floatWin.getSize();
    log.info(`[recording] show float: was visible=${wasVisible} old=(${oldX},${oldY}) ${oldW}x${oldH} → target=(${x},${y}) 520x${h}`);
    floatWin.setBounds({ x, y, width: 520, height: h });
    if (!wasVisible) floatWin.showInactive();
  }

  // ════════════════════════════════════════════
  // 本地 ASR 分支
  // ════════════════════════════════════════════
  if (provider === 'local') {
    if (!asrCfg.localModelId) {
      log.warn('[recording] local provider but no model selected');
      sendToFloat('asr:error', { code: 'NO_MODEL', message: '请先在设置中下载并选择一个本地模型' });
      openSettings();
      return;
    }
    const modelPath = modelManager.getModelPath(asrCfg.localModelId);
    if (!modelPath) {
      log.warn(`[recording] local model not on disk: ${asrCfg.localModelId}`);
      sendToFloat('asr:error', { code: 'MODEL_MISSING', message: `模型未下载: ${asrCfg.localModelId}` });
      openSettings();
      return;
    }

    isRecording = true;
    currentUseAI = useAI;
    currentFinalText = '';
    currentPolishedText = '';
    currentPartialText = '';
    polishedCache = {};

    setFloatState('recording');
    const modelInfo = BUILTIN_MODELS.find((m) => m.id === asrCfg.localModelId);
    currentAsrProvider = 'local';
    currentAsrLabel = modelInfo ? modelInfo.displayName : `🤖 ${asrCfg.localModelId}`;
    log.info(`[recording] asrProvider=local model=${asrCfg.localModelId} label=${currentAsrLabel}`);

    try {
      asrClient = new LocalASRClient({
        modelPath,
        language: asrCfg.language,
        threads: asrCfg.threads,
      });
      const thisSession = currentSession;
      asrClient.on('final', (r) => {
        if (currentSession !== thisSession) {
          log.info(`[recording] ignoring stale LOCAL final: "${r.text?.slice(0, 30)}"`);
          return;
        }
        log.info(`[recording] LOCAL FINAL: "${r.text}"`);
        currentFinalText = r.text;
        sendToFloat('asr:final', r);
        onRecordingDone();
      });
      asrClient.on('error', (e) => {
        if (currentSession !== thisSession) {
          log.info(`[recording] ignoring stale LOCAL error`);
          return;
        }
        log.error('[recording] LOCAL ASR error', e);
        sendToFloat('asr:error', e);
      });
      await asrClient.start();
      log.info('[recording] LocalASR ready, waiting for audio');
    } catch (e: any) {
      log.error('[recording] LocalASR start failed', e);
      sendToFloat('asr:error', { code: 'START_FAILED', message: e.message || '启动识别失败' });
      isRecording = false;
      setFloatState('idle');
    }
    return;
  }

  // ════════════════════════════════════════════
  // 腾讯云 ASR 分支（原逻辑）
  // ════════════════════════════════════════════
  const asr = config.get('tencentASR');

  log.info(
    `[recording] ASR provider = TENCENT CLOUD ` +
    `appId=${asr.appId} engineType=${asr.engineType} ` +
    `secretId=${asr.secretId?.slice(0, 8)}…`
  );

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
  currentPolishedText = '';
  currentPartialText = '';
  polishedCache = {};

  setFloatState('recording');
  // 记录当前会话的 ASR provider 和引擎标签（用于浮窗显示）
  currentAsrProvider = 'tencent';
  currentAsrLabel = `☁️ 腾讯云 ${asr.engineType.replace('16k_', '')}`;
  log.info(`[recording] asrProvider=${currentAsrProvider} label=${currentAsrLabel}`);

  try {
    asrClient = new TencentASRClient({
      appId: asr.appId,
      secretId: asr.secretId,
      secretKey: asr.secretKey,
      engineType: asr.engineType,
    });
    // 捕获本会话 ID（每次 startRecording 自增 currentSession）
    const thisSession = currentSession;

    asrClient.on('partial', (r) => {
      // 同会话内的 partial 永远处理；新会话开始或旧 session 被换掉才吞掉
      if (currentSession !== thisSession) {
        log.info(`[recording] ignoring stale partial (session ended): "${r.text?.slice(0, 30)}"`);
        return;
      }
      log.info(`[recording] partial: "${r.text}"`);
      currentPartialText = r.text;
      sendToFloat('asr:partial', r);
    });

    asrClient.on('final', (r) => {
      // 关键：Tencent 的 'final' 是 stop() 之后 461ms 才到，
      // 旧的 asrClient 引用 check 会误判为 stale
      if (currentSession !== thisSession) {
        log.info(`[recording] ignoring stale FINAL (session ended): "${r.text?.slice(0, 30)}"`);
        return;
      }
      log.info(`[recording] FINAL: "${r.text}"`);
      currentFinalText = r.text;
      sendToFloat('asr:final', r);
      onRecordingDone();
    });

    // VAD 句尾事件不再自动停止 — 由用户手动按键停止

    asrClient.on('error', (e) => {
      // 忽略已结束会话的延迟错误（如腾讯云 15 秒未发音频超时在用户停止后才到达）
      if (currentSession !== thisSession) {
        log.info(`[recording] ignoring stale ASR error (session ended): ${e?.code || ''} ${e?.message || ''}`);
        return;
      }
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
    setFloatState('idle');
  }
}

async function stopRecording() {
  if (!isRecording || !asrClient) return;
  isRecording = false;
  const thisAsrClient = asrClient;

  // 立即切到 transcribing：告诉用户"录音已停，正在识别中"
  setFloatState('transcribing');

  try {
    await thisAsrClient.stop();
  } catch (e) {
    log.error('[recording] stop error', e);
  }
  if (asrClient === thisAsrClient) asrClient = null;

  // 兜底：若 'final' 事件丢失（理论上不会发生），状态会卡在 transcribing
  // 本地模式: 3 分钟兜底（whisper-cli 跑得久，medium 模型 60s 录音可能要 30s 转写）
  // 云端模式: 30s 兜底
  const timeout = currentAsrProvider === 'local' ? 180_000 : 30_000;
  setTimeout(() => {
    if (currentFloatState === 'transcribing' && asrClient === null) {
      log.warn(`[recording] transcribing timeout (${timeout / 1000}s) — forcing idle`);
      setFloatState('idle');
    }
  }, timeout);
}

/** transcribing 状态最短 hold 时长（让用户能看到"识别中"闪过） */
const MIN_TRANSCRIBING_MS = 300;
let transcribingStartedAt = 0;

async function onRecordingDone() {
  const text = currentFinalText;
  // transcribing 状态最少 hold 300ms，让用户能看清"识别中"
  await ensureTranscribingDuration();
  if (!text) {
    setFloatState('idle');
    return;
  }

  // 1. 写历史
  if (config.get('history').enabled) {
    try {
      const hid = history.add({ text, polishedText: null, usedAi: false });
      log.info(`[history] saved #${hid}: "${text.slice(0, 30)}..."`);
    } catch (e) {
      log.error('[history] add failed', e);
    }
  }

  // 2. 进入 preview 状态，让用户选择"直接注入"或"AI 优化"
  // 不再自动注入，让用户主动选
  setFloatState('preview');
  sendToFloat('llm:start', { original: text });
  logFloatWindowState('preview entered');
}

/** 打印浮窗当前状态（位置/大小/可见性）— 调试用 */
function logFloatWindowState(reason: string) {
  if (!floatWin || floatWin.isDestroyed()) {
    log.info(`[window] float state (${reason}): DESTROYED`);
    return;
  }
  const [x, y] = floatWin.getPosition();
  const [w, h] = floatWin.getSize();
  log.info(`[window] float state (${reason}): pos=(${x},${y}) size=${w}x${h} visible=${floatWin.isVisible()} opacity=${floatWin.getOpacity()}`);
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
      setFloatState('idle');
    }, 1500);
    return;
  }

  let polished = '';
  try {
    const client = new LLMClient({
      baseURL: llm.baseURL,
      apiKey: llm.apiKey,
      model: llm.model,
      systemPrompt: getActiveSystemPrompt(),
    });
    setFloatState('preview');
    sendToFloat('llm:start', { original: text });
    for await (const chunk of client.polishStream(text)) {
      polished += chunk;
      sendToFloat('llm:chunk', { text: polished });
    }
    sendToFloat('llm:done', { text: stripThinkTags(polished) });
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

/** 隐藏浮窗：先重置到默认录音态尺寸再 hide，避免下次 show 时以预览大尺寸闪现 */
function hideFloatWindow() {
  if (!floatWin || floatWin.isDestroyed()) return;
  const h = Math.min(140, screen.getPrimaryDisplay().workAreaSize.height - 48);
  const [oldX, oldY] = floatWin.getPosition();
  const [oldW, oldH] = floatWin.getSize();
  log.info(`[window] hideFloatWindow: old=(${oldX},${oldY}) ${oldW}x${oldH} → reset to 520x${h} then hide`);
  floatWin.setSize(520, h);
  floatWin.hide();
}

/**
 * 按状态管理动态快捷键 — 只在需要时占用全局快捷键，避免干扰其他应用
 * - 常驻 4 个（push-to-talk / push-to-talk-with-ai / open-settings / open-history）由 hotkey.register() 管
 * - 动态 1 个：cancel（Esc），录音/转写/优化/预览 都能用
 * - preview 中的 Alt+1..5 / Ctrl+Alt+1 / Shift+2 / Tab 由 FloatBubble 内 keydown 监听处理
 *   （Trae 等 IDE 的全局快捷键会抢占 globalShortcut.register 静默失败，
 *    改在浮窗 preview 状态 focus() 时用本地 keydown 兜底，不依赖 globalShortcut）
 * - idle 状态：cancel 也不注册 → Esc 释放给其他应用
 */
function updateDynamicShortcuts(state: string) {
  if (state === 'idle') {
    hotkey.unregisterDynamic('cancel');
  } else {
    hotkey.registerDynamic('cancel');
  }
}

/** 用 selectedPromptIds 中第 index 个提示词优化文本 */
async function polishWithSlot(index: number) {
  if (!currentFinalText) return;
  const llm = config.get('llm');
  if (!llm.apiKey) {
    sendToFloat('asr:error', { code: 'NO_LLM_CONFIG', message: '请先在设置中配置 LLM API Key' });
    return;
  }
  const promptId = llm.selectedPromptIds?.[index];
  const prompt = promptId ? llm.prompts?.find(p => p.id === promptId) : null;
  const systemPrompt = prompt?.prompt || llm.systemPrompt;

  // 如果已有当前 slot 的优化结果 → 注入
  const key = `polished_${index}` as keyof typeof polishedCache;
  if (polishedCache[key]) {
    log.info(`[hotkey] ai-optimize-${index + 1}: inject polished`);
    const result = await injectText(polishedCache[key]!, { mode: config.get('general').injectMode });
    sendToFloat('inject:result', result);
    // 600ms 提示后隐藏；不切 idle（避免渲染器短暂渲染录音框）
    setTimeout(() => {
      currentFinalText = '';
      currentPolishedText = '';
      polishedCache = {};
      hideFloatWindow();
    }, 600);
    return;
  }

  log.info(`[hotkey] ai-optimize-${index + 1}: polish with "${prompt?.name || 'default'}"`);
  setFloatState('processing');
  try {
    const client = new LLMClient({ baseURL: llm.baseURL, apiKey: llm.apiKey, model: llm.model, systemPrompt });
    let polished = '';
    for await (const chunk of client.polishStream(currentFinalText)) {
      polished += chunk;
      sendToFloat('llm:chunk', { text: polished });
    }
    const clean = stripThinkTags(polished);
    polishedCache[key] = clean;
    sendToFloat('llm:done', { text: clean });
    sendToFloat('polish:slot', { index, text: clean, promptName: prompt?.name || '默认' });
    setFloatState('preview');
    if (config.get('history').enabled) {
      try { history.add({ text: currentFinalText, polishedText: clean, usedAi: true }); } catch {}
    }
  } catch (e: any) {
    log.error('[polish] error', e);
    sendToFloat('asr:error', { code: 'LLM_FAILED', message: e.message || 'AI 优化失败' });
    setFloatState('preview');
  }
}

// 多个 slot 的优化结果缓存
let polishedCache: Record<string, string> = {};

// 当前会话的 ASR provider（startRecording 时设置，transcribing 状态用于显示正确文案）
let currentAsrProvider: 'local' | 'tencent' = 'tencent';
// 当前会话的 ASR 引擎标签（用于浮窗显示 "☁️ 腾讯云" / "🤖 Whisper Small" 等）
let currentAsrLabel: string = '☁️ 腾讯云';

function setFloatState(state: string) {
  const prev = currentFloatState;
  currentFloatState = state;
  // 记录 transcribing 起始时间（用于最少 300ms hold）
  if (state === 'transcribing') transcribingStartedAt = Date.now();
  log.info(`[state] ${prev} → ${state}`);
  // state:change 携带 provider + label，让渲染器显示正确的"识别中"文案和引擎标签
  sendToFloat('state:change', { state, provider: currentAsrProvider, label: currentAsrLabel });
  updateDynamicShortcuts(state);

  // 强制 resize：状态切到 preview/transcribing/processing 时，主动把窗口放大
  // （不再依赖 renderer useEffect 触发，那个路径有 bug 导致窗口一直是 520x140）
  if (state === 'preview' || state === 'processing') {
    // 必须 ≥ 240 才能装下"识别文本 + 文本框 + 操作按钮行"，
    // 否则下半部分被窗口边界裁掉，看起来"预览区不见了"
    forceResizeWindow(800, 240);
  } else if (state === 'transcribing' || state === 'recording') {
    forceResizeWindow(520, 140);
  } else if (state === 'idle') {
    forceResizeWindow(520, 140);
  }

  // 调试：进入关键状态时打印窗口状态
  if (state === 'preview' || state === 'recording' || state === 'idle' || state === 'transcribing') {
    setImmediate(() => logFloatWindowState(`state=${state}`));
  }
  // 防御性：进入 preview 时强制确保窗口可见（之前可能被某事件隐藏了）
  if (state === 'preview' || state === 'transcribing' || state === 'recording') {
    if (floatWin && !floatWin.isDestroyed() && !floatWin.isVisible()) {
      log.warn(`[state] window was hidden, force showing for state=${state}`);
      floatWin.showInactive();
    }
  }

  // preview 状态时强力唤起：moveTop + focus + flashFrame + 系统通知
  // 必须 focus()：preview 中 Alt+1..5 / Ctrl+Alt+1 / Shift+2 由浮窗内 keydown 监听
  // （Trae 等 IDE 的全局快捷键会抢占 VoiceFlow 的 globalShortcut.register，
  //   所以放弃走 globalShortcut，改在浮窗聚焦时用本地 keydown 兜底）
  if (state === 'preview' && floatWin && !floatWin.isDestroyed()) {
    try {
      // 把浮窗强制置顶
      floatWin.moveTop();
      // 聚焦：让窗口接收 keydown 事件，preview 内的快捷键才能触发
      floatWin.focus();
      // Windows 任务栏图标闪烁，吸引注意
      floatWin.flashFrame(true);
      log.info('[preview] moveTop + focus + flashFrame fired to grab attention');
    } catch (e: any) {
      log.warn(`[preview] moveTop/focus/flashFrame failed: ${e.message}`);
    }
    // 发送系统通知
    try {
      if (Notification.isSupported()) {
        new Notification({
          title: '🎤 识别完成',
          body: `点击查看预览 · 引擎：${currentAsrLabel}\n按 Shift+! 注入原文 · Shift+@ 注入优化`,
          silent: false,
        }).show();
      }
    } catch (e: any) {
      log.warn(`[preview] notification failed: ${e.message}`);
    }
  }
}

/** 强制设置浮窗尺寸（不走 IPC，main 进程自己改） */
function forceResizeWindow(width: number, height: number) {
  if (!floatWin || floatWin.isDestroyed()) return;
  const [oldW, oldH] = floatWin.getSize();
  if (oldW === width && oldH === height) return; // 已经是对的不动
  const display = screen.getPrimaryDisplay();
  const margin = 24;
  // 水平居中
  const nx = Math.floor((display.workAreaSize.width - width) / 2);
  // 底部对齐
  const fp = getFloatPosition();
  const ny = Math.max(margin, Math.min(display.workAreaSize.height - height - margin, fp.y));
  log.info(`[resize] force-resize: ${oldW}x${oldH} → ${width}x${height} at (${nx},${ny})`);
  floatWin.setBounds({ x: nx, y: ny, width, height });
}

/** 等到 transcribing 状态满 300ms（最少）再返回，保证 UI 看得见 */
async function ensureTranscribingDuration(): Promise<void> {
  if (transcribingStartedAt === 0) return;
  const elapsed = Date.now() - transcribingStartedAt;
  if (elapsed < MIN_TRANSCRIBING_MS) {
    await new Promise(r => setTimeout(r, MIN_TRANSCRIBING_MS - elapsed));
  }
}

/** 过滤 LLM 输出中的 think 思考标签 */
function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/** 获取当前激活的 system prompt（从提示词列表中按 activePromptId 查找） */
function getActiveSystemPrompt(): string {
  const llm = config.get('llm');
  if (llm.activePromptId && llm.prompts?.length) {
    const prompt = llm.prompts.find(p => p.id === llm.activePromptId);
    if (prompt) return prompt.prompt;
  }
  return llm.systemPrompt; // fallback
}

function openSettings() {
  createSettingsWindow();
}

ipcMain.on('float:hide', () => hideFloatWindow());

// 浮窗大小切换：保持窗口中心不变，仅改变尺寸
ipcMain.on('float:resize', (_e, { wide, previewHeight }: { wide: boolean; previewHeight?: number }) => {
  if (!floatWin || floatWin.isDestroyed()) return;
  const display = screen.getPrimaryDisplay();
  const margin = 24;
  const defaultW = 520, defaultH = 140;
  const previewW = 800;
  const ph = Math.min(previewHeight || 240, display.workAreaSize.height - 80);
  const w = wide ? previewW : defaultW;
  const h = wide ? ph : defaultH;
  const [oldX, oldY] = floatWin.getPosition();
  const [oldW, oldH] = floatWin.getSize();
  let nx: number, ny: number;
  if (wide) {
    // 预览/处理：水平居中（更宽的窗口居中显示更自然），垂直沿用用户的 getFloatPosition 偏好
    const fp = getFloatPosition();
    nx = Math.floor((display.workAreaSize.width - w) / 2);
    ny = Math.max(margin, Math.min(display.workAreaSize.height - h - margin, fp.y));
  } else {
    // 录音/空闲：完全沿用用户配置的 getFloatPosition（避免覆盖 appearance.position）
    const fp = getFloatPosition();
    nx = fp.x;
    ny = fp.y;
  }
  log.info(`[resize] float:resize wide=${wide} prevH=${previewHeight} old=(${oldX},${oldY}) ${oldW}x${oldH} → (${nx},${ny}) ${w}x${h}`);
  // setBounds 原子设置，避免先 resize 再 reposition 造成的中间帧
  floatWin.setBounds({ x: nx, y: ny, width: w, height: h });
});

// 鼠标进入气泡区域 → 启用鼠标事件；离开 → 穿透
ipcMain.on('float:mouse-enter', () => {
  floatWin?.setIgnoreMouseEvents(false);
});
ipcMain.on('float:mouse-leave', () => {
  floatWin?.setIgnoreMouseEvents(true, { forward: true });
});

ipcMain.handle('float:get-bounds', () => floatWin?.getBounds() ?? null);

// 录音控制（来自浮窗内点击 / 调试用）
ipcMain.on('recording:start', (_e, { useAI }: { useAI: boolean }) =>
  startRecording(useAI)
);
ipcMain.on('recording:stop', () => stopRecording());

// 音频帧统计 + VAD
let audioFrameCount = 0;
let lastFrameLog = Date.now();
const vad = new EnergyVAD();

ipcMain.on('asr:audio-frame', (_e, pcm: Uint8Array) => {
  if (asrClient && isRecording) {
    audioFrameCount++;
    const buf = Buffer.from(pcm);
    asrClient.sendAudio(buf);
    // VAD：实时标记语音段起止
    vad.pushFrame(buf);
    // 每秒打一次日志
    const now = Date.now();
    if (now - lastFrameLog > 1000) {
      const sum = vad.summary();
      log.info(`[audio] received ${audioFrameCount} frames, last size=${pcm.byteLength} | vad: total=${sum.totalSamples / 16000}s speech=${(sum.speechRatio * 100).toFixed(0)}% ${sum.hasSpeech ? `trim=[${(sum.speechStartSample/16000).toFixed(2)}s, ${(sum.speechEndSample/16000).toFixed(2)}s]` : 'no-speech'}`);
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
  // 600ms 提示后隐藏；不切 idle（避免渲染器短暂渲染录音框）
  setTimeout(() => {
    currentFinalText = '';
    currentPolishedText = '';
    polishedCache = {};
    hideFloatWindow();
  }, 600);
});

ipcMain.on('llm:discard', () => {
  setFloatState('idle');
  setTimeout(() => hideFloatWindow(), 400);
});

ipcMain.on('llm:edit', () => {
  // 暂不实现编辑
});

// 用户主动请求 AI 优化
ipcMain.on('llm:request-polish', async (_e, { text, slotIndex }: { text: string; slotIndex?: number }) => {
  if (!text) return;
  // 指定了 slot → 走 polishWithSlot
  if (slotIndex !== undefined && slotIndex >= 0) {
    currentFinalText = text;
    await polishWithSlot(slotIndex);
    return;
  }
  const llm = config.get('llm');
  if (!llm.apiKey) {
    sendToFloat('asr:error', { code: 'NO_LLM_CONFIG', message: '请先在设置中配置 LLM API Key' });
    return;
  }
  setFloatState('processing');
  try {
    const client = new LLMClient({ baseURL: llm.baseURL, apiKey: llm.apiKey, model: llm.model, systemPrompt: getActiveSystemPrompt() });
    let polished = '';
    for await (const chunk of client.polishStream(text)) {
      polished += chunk;
      sendToFloat('llm:chunk', { text: polished });
    }
    sendToFloat('llm:done', { text: stripThinkTags(polished) });
    setFloatState('preview');
    if (config.get('history').enabled) {
      try { history.add({ text, polishedText: polished, usedAi: true }); } catch {}
    }
  } catch (e: any) {
    log.error('[polish] error', e);
    sendToFloat('asr:error', { code: 'LLM_FAILED', message: e.message || 'AI 优化失败' });
    setFloatState('preview');
  }
});

// 用户主动直接注入（不调 AI）
ipcMain.on('inject:request', async (_e, { text }: { text: string }) => {
  if (!text) return;
  const result = await injectText(text, {
    mode: config.get('general').injectMode,
  });
  sendToFloat('inject:result', result);
  // 600ms 提示后隐藏；不切 idle（避免渲染器短暂渲染录音框）
  setTimeout(() => {
    currentFinalText = '';
    currentPolishedText = '';
    polishedCache = {};
    hideFloatWindow();
  }, 600);
});

// 用户丢弃本次结果
ipcMain.on('preview:discard', () => {
  setFloatState('idle');
  setTimeout(() => hideFloatWindow(), 300);
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
  // register() 的 unregister() 会清除动态快捷键，需要恢复
  updateDynamicShortcuts(currentFloatState);
  // 应用外观设置
  const opacity = config.get('appearance').opacity;
  if (floatWin && !floatWin.isDestroyed()) {
    floatWin.setOpacity(opacity);
    floatWin.webContents.executeJavaScript(`document.body.style.setProperty('--opacity', '${opacity}')`);
  }
  // 通知浮窗刷新快捷键显示
  sendToFloat('config:updated', { hotkeys: config.get('hotkeys') });
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

// ============================================================
// 本地 ASR 模型管理
// ============================================================
ipcMain.handle('model:list', async () => {
  const all = BUILTIN_MODELS;
  const downloadedSet = new Set(
    (await modelManager.listDownloaded()).map((m) => m.id),
  );
  return all.map((m) => ({ ...m, downloaded: downloadedSet.has(m.id) }));
});

ipcMain.handle('model:download', async (_e, modelId: string) => {
  try {
    await modelManager.download(modelId, (p) => sendToFloat('model:progress', p));
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.on('model:cancel', (_e, modelId: string) => {
  modelManager.cancel(modelId);
});

ipcMain.handle('model:delete', async (_e, modelId: string) => {
  return await modelManager.delete(modelId);
});

// 打开设置窗口
ipcMain.on('open:settings', () => openSettings());
ipcMain.on('open:history', () => createHistoryWindow());

// 打开外部 URL（浏览器）
ipcMain.on('open:external', (_e, url: string) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) {
    log.info(`[shell] openExternal: ${url}`);
    shell.openExternal(url);
  }
});

// ============================================================
// 快捷键回调
// ============================================================
// 长按防抖：避免 OS 自动重复发送 keydown 触发 N 次 toggle
let lastHotkeyTime = 0;
const HOTKEY_DEBOUNCE_MS = 400;

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
        log.info('[hotkey] push-to-talk: stop');
        stopRecording();
      } else {
        log.info('[hotkey] push-to-talk: start');
        startRecording(false);
      }
      break;
    case 'push-to-talk-with-ai':
      if (isRecording) {
        stopRecording();
      } else {
        startRecording(true);
      }
      break;
    case 'cancel':
      // Esc 取消
      if (currentFinalText) {
        // 在 preview 状态下按 Esc = 丢弃
        setFloatState('idle');
        currentFinalText = '';
        currentPolishedText = '';
        currentPartialText = '';
        hideFloatWindow();
      } else {
        stopRecording();
        setFloatState('idle');
        hideFloatWindow();
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
        // 600ms 提示后隐藏；不切 idle（避免渲染器短暂渲染录音框）
        setTimeout(() => {
          currentFinalText = '';
          currentPolishedText = '';
          polishedCache = {};
          hideFloatWindow();
        }, 600);
      }
      break;
    case 'inject-polished':
      // 快捷键：注入最后一次 AI 优化结果（任意 slot）
      if (currentFinalText) {
        const latestPolished = Object.values(polishedCache).find(Boolean) || currentPolishedText;
        if (latestPolished) {
          log.info('[hotkey] inject-polished');
          const result = await injectText(latestPolished, {
            mode: config.get('general').injectMode,
          });
          sendToFloat('inject:result', result);
          // 600ms 提示后隐藏；不切 idle（避免渲染器短暂渲染录音框）
          setTimeout(() => {
            currentFinalText = '';
            currentPolishedText = '';
            polishedCache = {};
            hideFloatWindow();
          }, 600);
        }
      }
      break;
    case 'ai-optimize-1': await polishWithSlot(0); break;
    case 'ai-optimize-2': await polishWithSlot(1); break;
    case 'ai-optimize-3': await polishWithSlot(2); break;
    case 'ai-optimize-4': await polishWithSlot(3); break;
    case 'ai-optimize-5': await polishWithSlot(4); break;
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
  log.info('[startup] app ready, loading config...');
  await config.load();
  log.info(`[startup] config loaded, hotkeys: ${JSON.stringify(config.get('hotkeys'))}`);

  // 初始化模型目录(%APPDATA%/voiceflow/models/)
  await modelManager.init();

  // 同步开机自启设置
  app.setLoginItemSettings({
    openAtLogin: config.get('general').autoLaunch,
  });

  log.info('[startup] creating windows...');
  createFloatWindow();
  createTray();

  // 前台窗口追踪：非浮窗前台时记录用户窗口，供点击浮窗启动录音时回退
  setInterval(() => {
    try {
      if (floatWin && !floatWin.isDestroyed() && floatWin.isFocused()) return;
      const hwnd = getForegroundHwnd();
      if (hwnd) {
        lastUserForegroundHwnd = hwnd;
        setFallbackTargetHwnd(hwnd);
      }
    } catch {}
  }, 600);

  // 注册快捷键（先加载用户保存的配置）
  hotkey.updateConfig(config.get('hotkeys'));
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
