/**
 * 全局快捷键管理器
 * - 默认: Ctrl+Alt+Z 推说 / Ctrl+Alt+X 推说+AI / Esc 取消 / Tab 切模式 / Ctrl+, 设置 / Ctrl+Shift+H 历史
 * - 注册失败时降级到本地快捷键
 */
import { globalShortcut, app } from 'electron';
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
  | 'inject-polished'
  | 'ai-optimize-1'
  | 'ai-optimize-2'
  | 'ai-optimize-3'
  | 'ai-optimize-4'
  | 'ai-optimize-5';

export type HotkeyHandler = (action: HotkeyAction) => void;

const DEFAULTS: HotkeyConfig = {
  pushToTalk: 'CommandOrControl+Alt+Z',
  pushToTalkWithAI: 'CommandOrControl+Alt+X',
  cancel: 'Escape',
  toggleMode: 'Tab',
  openSettings: 'CommandOrControl+,',
  openHistory: 'CommandOrControl+Shift+H',
  confirmInject: 'CommandOrControl+Alt+1',
  injectPolished: 'Shift+@',
  aiOptimize1: 'Alt+1',
  aiOptimize2: 'Alt+2',
  aiOptimize3: 'Alt+3',
  aiOptimize4: 'Alt+4',
  aiOptimize5: 'Alt+5',
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

  /**
   * 注册常驻快捷键（任何状态都可能用到）
   * - 注入/优化类的快捷键（confirm-inject / inject-polished / ai-optimize-1..5）不进这里
   *   它们通过 updateDynamicShortcuts() 按状态动态注册：仅在 preview 状态有效
   *   避免 idle 状态下 Alt+1..5 / Shift+2 抢占全局快捷键、干扰其他应用
   */
  register(): { ok: HotkeyAction[]; failed: HotkeyAction[] } {
    this.unregister();
    const ok: HotkeyAction[] = [];
    const failed: HotkeyAction[] = [];

    const map: Array<[HotkeyAction, string]> = [
      ['push-to-talk', this.config.pushToTalk],
      ['push-to-talk-with-ai', this.config.pushToTalkWithAI],
      ['open-settings', this.config.openSettings],
      ['open-history', this.config.openHistory],
    ];

    // 跟踪已注册的 accelerator，防止重复
    const usedAccelerators = new Set<string>();

    for (const [action, accelerator] of map) {
      if (!accelerator) continue;

      // 检查是否与之前的快捷键重复
      if (usedAccelerators.has(accelerator)) {
        log.warn(`Hotkey duplicate skipped: ${action} = ${accelerator} (already used)`);
        continue;
      }

      try {
        const success = globalShortcut.register(accelerator, () => {
          this.handler?.(action);
        });
        if (success) {
          ok.push(action);
          this.registered.set(action, accelerator);
          usedAccelerators.add(accelerator);
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

  /** 按需注册一个全局快捷键（用于 Esc/Tab 等需要动态管理的按键） */
  registerDynamic(action: HotkeyAction): boolean {
    const accelerator = this.config[action as keyof HotkeyConfig] as string;
    if (!accelerator) return false;

    // 如果已注册则跳过
    if (this.registered.has(action)) return true;

    try {
      const success = globalShortcut.register(accelerator, () => {
        this.handler?.(action);
      });
      if (success) {
        this.registered.set(action, accelerator);
        log.info(`Hotkey dynamic register ok: ${action} = ${accelerator}`);
      } else {
        log.warn(`Hotkey dynamic register failed: ${action} = ${accelerator}`);
      }
      return success;
    } catch (e) {
      log.error(`Hotkey dynamic register threw: ${action} = ${accelerator}`, e);
      return false;
    }
  }

  /** 取消一个动态注册的快捷键 */
  unregisterDynamic(action: HotkeyAction) {
    const accelerator = this.registered.get(action);
    if (!accelerator) return;
    try {
      globalShortcut.unregister(accelerator);
    } catch {}
    this.registered.delete(action);
    log.info(`Hotkey dynamic unregister: ${action}`);
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
