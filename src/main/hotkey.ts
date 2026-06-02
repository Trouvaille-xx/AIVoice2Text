/**
 * 全局快捷键管理器
 * - 默认: Ctrl+Alt+Z 推说 / Ctrl+Alt+X 推说+AI / Esc 取消 / Tab 切模式 / Ctrl+, 设置 / Ctrl+Shift+H 历史
 * - 注册失败时降级到本地快捷键
 */
import { globalShortcut, app, BrowserWindow } from 'electron';
import log from 'electron-log/main';
import type { HotkeyConfig } from '@shared/types';

export type HotkeyAction =
  | 'push-to-talk'
  | 'push-to-talk-with-ai'
  | 'cancel'
  | 'toggle-mode'
  | 'open-settings'
  | 'open-history'
  | 'confirm-inject'
  | 'ai-optimize';

export type HotkeyHandler = (action: HotkeyAction) => void;

const DEFAULTS: HotkeyConfig = {
  pushToTalk: 'CommandOrControl+Alt+Z',
  pushToTalkWithAI: 'CommandOrControl+Alt+X',
  cancel: 'Escape',
  toggleMode: 'Tab',
  openSettings: 'CommandOrControl+,',
  openHistory: 'CommandOrControl+Shift+H',
  confirmInject: 'CommandOrControl+Alt+1',
  aiOptimize: 'CommandOrControl+Alt+2',
};

export class HotkeyManager {
  private config: HotkeyConfig;
  private handler: HotkeyHandler | null = null;
  private registered: Map<HotkeyAction, string> = new Map();
  private failed: HotkeyAction[] = [];

  constructor(config: Partial<HotkeyConfig> = {}) {
    this.config = { ...DEFAULTS, ...config };
  }

  setHandler(h: HotkeyHandler) {
    this.handler = h;
  }

  /** 注册所有快捷键 */
  register(): { ok: HotkeyAction[]; failed: HotkeyAction[] } {
    this.unregister();
    const ok: HotkeyAction[] = [];
    const failed: HotkeyAction[] = [];

    const map: Array<[HotkeyAction, string]> = [
      ['push-to-talk', this.config.pushToTalk],
      ['push-to-talk-with-ai', this.config.pushToTalkWithAI],
      ['cancel', this.config.cancel],
      ['toggle-mode', this.config.toggleMode],
      ['open-settings', this.config.openSettings],
      ['open-history', this.config.openHistory],
      ['confirm-inject', this.config.confirmInject],
      ['ai-optimize', this.config.aiOptimize],
    ];

    for (const [action, accelerator] of map) {
      if (!accelerator) continue;
      // Escape 单独处理：不能全局注册（会拦截用户在其他应用按 Esc）
      if (action === 'cancel' || action === 'toggle-mode') {
        // 这两个走"应用内"快捷键，不走 globalShortcut
        this.installLocalShortcut(accelerator, action);
        ok.push(action);
        this.registered.set(action, accelerator);
        continue;
      }
      try {
        const success = globalShortcut.register(accelerator, () => {
          this.handler?.(action);
        });
        if (success) {
          ok.push(action);
          this.registered.set(action, accelerator);
        } else {
          failed.push(action);
          log.warn(`Hotkey register failed: ${action} = ${accelerator}`);
        }
      } catch (e) {
        failed.push(action);
        log.error(`Hotkey register threw: ${action} = ${accelerator}`, e);
      }
    }

    this.failed = failed;
    log.info(`Hotkey registered: ${ok.length} ok, ${failed.length} failed`);
    return { ok, failed };
  }

  /** 在浮窗窗口内注册本地快捷键（Esc/Tab） */
  private installLocalShortcut(accelerator: string, action: HotkeyAction) {
    // 浮窗聚焦时，通过 before-input-event 捕获
    const win = BrowserWindow.getAllWindows().find(
      (w) => w.webContents.getURL().includes('index.html') && !w.isDestroyed()
    );
    if (!win) return;

    const accelKey = accelerator.toLowerCase();
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (accelKey === 'escape' && input.key === 'Escape') {
        this.handler?.(action);
        event.preventDefault();
      } else if (accelKey === 'tab' && input.key === 'Tab') {
        this.handler?.(action);
        event.preventDefault();
      }
    });
  }

  unregister() {
    for (const accel of this.registered.values()) {
      try {
        globalShortcut.unregister(accel);
      } catch {}
    }
    this.registered.clear();
  }

  getConfig(): HotkeyConfig {
    return { ...this.config };
  }

  updateConfig(patch: Partial<HotkeyConfig>) {
    this.config = { ...this.config, ...patch };
  }

  getFailed(): HotkeyAction[] {
    return [...this.failed];
  }

  isReady(): boolean {
    return this.registered.size > 0;
  }
}
