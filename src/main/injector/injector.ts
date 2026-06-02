/**
 * Windows 文本注入器
 * 三级 fallback:
 *  ① UIA ValuePattern.SetValue (干净)
 *  ② 剪贴板 + 模拟 Ctrl+V (contenteditable / 富文本)
 *  ③ SendInput 逐字 (兜底)
 */
import { spawn, exec, execSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import log from 'electron-log/main';
import type { InjectOptions } from '@shared/types';

export interface InjectResult {
  ok: boolean;
  method: 'uia' | 'clipboard' | 'sendinput' | 'none';
  message: string;
}

/** 记录用户期望注入的目标窗口句柄（录音前抓取） */
let savedTargetHwnd: number | null = null;

/**
 * 记录当前前台窗口句柄
 * 在录音开始前调用，让注入时能切回去
 */
export function captureTargetWindow(): void {
  const hwnd = getForegroundHwnd();
  if (hwnd) {
    savedTargetHwnd = hwnd;
    log.info(`[injector] captured target window hwnd=${hwnd}`);
  }
}

function getForegroundHwnd(): number | null {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
}
"@
$hwnd = [Win32]::GetForegroundWindow()
Write-Output ("HWND=" + $hwnd)
`;
  try {
    const result = execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, '`"').replace(/\n/g, ' ')}"`,
      { encoding: 'utf-8', timeout: 5000 }
    );
    const text = result.toString();
    const m = text.match(/HWND=(\d+)/);
    if (m) return parseInt(m[1], 10);
  } catch (e) {
    log.warn('[injector] getForegroundHwnd failed', e);
  }
  return null;
}

/**
 * 把窗口拉到前台
 */
function setForegroundWindow(hwnd: number): boolean {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
}
"@
$hwnd = ${hwnd}
[Win32]::ShowWindow($hwnd, 9) | Out-Null  # SW_RESTORE
[Win32]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 200
$cur = [Win32]::GetForegroundWindow()
Write-Output ("NEW_HWND=" + $cur)
`;
  try {
    const result = execSync(script);
    const text = result.toString();
    const m = text.match(/NEW_HWND=(\d+)/);
    if (m) return parseInt(m[1], 10) === hwnd;
  } catch (e) {
    log.warn(`[injector] setForegroundWindow(${hwnd}) failed`, e);
  }
  return false;
}

/**
 * 主入口
 */
export async function injectText(
  text: string,
  options: InjectOptions = { mode: 'replace' }
): Promise<InjectResult> {
  if (!text) {
    return { ok: false, method: 'none', message: '空文本' };
  }

  // 如果有保存的目标窗口，先切回去
  if (savedTargetHwnd) {
    log.info(`[injector] restoring target window hwnd=${savedTargetHwnd}`);
    setForegroundWindow(savedTargetHwnd);
    // 等待窗口切换稳定
    await new Promise((r) => setTimeout(r, 200));
  }

  // 通过 UIA 查找焦点元素
  const element = await findFocusedElement();

  if (!element) {
    return {
      ok: false,
      method: 'none',
      message: '未找到焦点输入控件。请在开始录音前先点击目标输入框。',
    };
  }

  log.info(
    `[injector] found element: name="${element.name}" class="${element.className}" type="${element.controlType}" hasValue=${element.hasValuePattern}`
  );

  // 策略 1: UIA ValuePattern
  const uiaOk = await tryUIAInject(element, text, options);
  if (uiaOk) {
    return { ok: true, method: 'uia', message: 'UIA 注入成功' };
  }

  // 策略 2: 剪贴板 + Ctrl+V
  const cbOk = await tryClipboardInject(text, options);
  if (cbOk) {
    return { ok: true, method: 'clipboard', message: '剪贴板注入成功' };
  }

  // 策略 3: SendInput 逐字
  const siOk = await trySendInputInject(text);
  if (siOk) {
    return { ok: true, method: 'sendinput', message: '键盘输入注入成功' };
  }

  return { ok: false, method: 'none', message: '所有注入策略均失败' };
}

interface UIAElement {
  name: string;
  className: string;
  controlType: string;
  hasValuePattern: boolean;
  isEditable: boolean;
}

async function findFocusedElement(): Promise<UIAElement | null> {
  // 通过 PowerShell 调用 UIA
  const script = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $el = [System.Windows.Automation.AutomationElement]::FocusedElement
  if ($el -eq $null) {
    Write-Output "STATUS=NO_FOCUS"
    exit 0
  }
  $name = ""
  $className = ""
  $controlType = ""
  try { $name = $el.Current.Name } catch { $name = "ERR_NAME: $($_.Exception.Message)" }
  try { $className = $el.Current.ClassName } catch { $className = "ERR_CLASS: $($_.Exception.Message)" }
  try { $controlType = $el.Current.ControlType.ProgrammaticName } catch { $controlType = "ERR_TYPE: $($_.Exception.Message)" }
  $hasValue = 'False'
  try {
    $p = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    if ($p -ne $null) { $hasValue = 'True' }
  } catch {}
  Write-Output ("NAME=" + $name)
  Write-Output ("CLASS=" + $className)
  Write-Output ("TYPE=" + $controlType)
  Write-Output ("HASVALUE=" + $hasValue)
  Write-Output "STATUS=OK"
  exit 0
} catch {
  Write-Output ("STATUS=ERROR: " + $_.Exception.GetType().FullName + ": " + $_.Exception.Message)
  exit 1
}
`;
  try {
    const result = await runPowerShell(script);
    log.info(`[injector] UIA query result: ${result.replace(/\n/g, ' | ')}`);
    if (!result.trim()) {
      log.warn('[injector] PowerShell returned empty');
      return null;
    }
    const lines = result.trim().split(/\r?\n/);
    const data: any = {};
    for (const line of lines) {
      const trimmed = line.trim();
      const [k, ...v] = trimmed.split('=');
      data[k] = v.join('=');
    }
    if (data.STATUS === 'NO_FOCUS') {
      log.warn('[injector] no focused element (前台窗口无焦点控件)');
      return null;
    }
    if (data.STATUS?.startsWith('ERROR')) {
      log.warn(`[injector] UIA error: ${data.STATUS}`);
      return null;
    }
    return {
      name: data.NAME || '',
      className: data.CLASS || '',
      controlType: data.TYPE || '',
      hasValuePattern: data.HASVALUE === 'True',
      isEditable:
        data.TYPE?.includes('Edit') ||
        data.TYPE?.includes('Document') ||
        data.CLASS?.toLowerCase().includes('edit'),
    };
  } catch (e: any) {
    log.warn(`[injector] findFocusedElement failed: ${e?.message || e}`);
    return null;
  }
}

async function tryUIAInject(
  element: UIAElement,
  text: string,
  options: InjectOptions
): Promise<boolean> {
  if (!element.hasValuePattern) return false;

  // 通过 PowerShell 调用 UIA SetValue
  // 注意: ValuePattern.SetValue 不支持"追加"，所以追加模式走剪贴板
  if (options.mode !== 'replace') return false;

  const escapedText = text.replace(/'/g, "''").replace(/`/g, '``');
  const script = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
try {
  $el = [System.Windows.Automation.AutomationElement]::FocusedElement
  $pattern = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  $pattern.SetValue('${escapedText}')
  exit 0
} catch {
  exit 1
}
`;
  try {
    const code = await runPowerShellCode(script);
    return code === 0;
  } catch {
    return false;
  }
}

async function tryClipboardInject(
  text: string,
  options: InjectOptions
): Promise<boolean> {
  // 用 base64 编码文本，避免 PowerShell here-string 解析问题
  const b64 = Buffer.from(text, 'utf-8').toString('base64');
  return new Promise((resolve) => {
    const script = path.join(os.tmpdir(), `vf_inject_${Date.now()}.ps1`);
    const psScript = `
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms

# 从 base64 解码文本
$text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64}'))

# 追加模式: 先 Ctrl+End 跳到末尾
$mode = '${options.mode}'
if ($mode -eq 'append' -or $mode -eq 'prepend') {
  [System.Windows.Forms.SendKeys]::SendWait('^{END}')
  Start-Sleep -Milliseconds 50
}

# 备份原剪贴板
$originalClip = ''
if ([System.Windows.Forms.Clipboard]::ContainsText()) {
  $originalClip = [System.Windows.Forms.Clipboard]::GetText()
}

# 写入剪贴板
[System.Windows.Forms.Clipboard]::SetText($text)

# 模拟 Ctrl+V
[System.Windows.Forms.SendKeys]::SendWait('^v')
Start-Sleep -Milliseconds 100

# 恢复原剪贴板
if ($originalClip -ne '') {
  [System.Windows.Forms.Clipboard]::SetText($originalClip)
}

exit 0
`;
    fs.writeFile(script, psScript, 'utf-8').then(() => {
      exec(
        `powershell -ExecutionPolicy Bypass -NoProfile -File "${script}"`,
        (err, stdout, stderr) => {
          fs.unlink(script).catch(() => {});
          if (err) {
            log.warn(`[injector] clipboard inject failed: ${stderr?.trim() || err.message}`);
            resolve(false);
          } else {
            resolve(true);
          }
        }
      );
    });
  });
}

async function trySendInputInject(text: string): Promise<boolean> {
  const b64 = Buffer.from(text, 'utf-8').toString('base64');
  return new Promise((resolve) => {
    const script = path.join(os.tmpdir(), `vf_inject_si_${Date.now()}.ps1`);
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64}'))
[System.Windows.Forms.SendKeys]::SendWait($text)
exit 0
`;
    fs.writeFile(script, psScript, 'utf-8').then(() => {
      exec(
        `powershell -ExecutionPolicy Bypass -NoProfile -File "${script}"`,
        (err, stdout, stderr) => {
          fs.unlink(script).catch(() => {});
          if (err) {
            log.warn(`[injector] sendinput inject failed: ${stderr?.trim() || err.message}`);
            resolve(false);
          } else {
            resolve(true);
          }
        }
      );
    });
  });
}

function runPowerShell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true }
    );
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.stderr.on('data', (d) => (err += d.toString()));
    proc.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || `exit ${code}`));
    });
    proc.on('error', (e) => reject(e));
  });
}

function runPowerShellCode(script: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ]);
    proc.on('close', (code) => resolve(code ?? -1));
    proc.on('error', () => resolve(-1));
  });
}
