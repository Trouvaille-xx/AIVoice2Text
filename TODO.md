# TODO — 本地 ASR 模型系统

## 1. 打包 whisper.cpp 引擎
- [x] 下载 `whisper-cli.exe` 放到 `bin/` 目录
- [x] `electron-builder.yml` 的 `extraResources` 添加 `bin/whisper-cli.exe`
- [x] `LocalASRClient.findWhisperBinary()` 优先查找 `resources/bin/whisper-cli.exe`
- [x] 移除引擎下载 UI（"需引擎" / "下载引擎" 按钮）
- [x] 模型管理器中删除 `ensureEngine()` 方法和 `WHISPER_CPP_INFO`

## 2. 本地模型就绪判断
- [x] `model:list` 中 `engineReady` 判断改为：引擎由应用自带，始终为 `true`
- [x] 已下载的模型直接显示 ✅ 可用（不再需要单独下载引擎）

## 3. 清理
- [x] 删除 `model:ensure-engine` IPC handler
- [x] 删除 preload 中 `ensureEngine` API
- [x] 删除设置面板中引擎进度条相关代码
- [x] 删除 `getMirrorUrl` 中 GitHub 镜像逻辑（不再需要）

## 4. 模型下载
- [x] 模型下载保持现有逻辑（hf-mirror.com 镜像）
- [x] 用户切换本地模型 → 下载模型 → 即可使用

---

## 5. 待修复 Bug

### Bug 1: 注入完成后预览框关闭，但录音框仍然显示
- 注入成功 → `floatWin?.hide()` 关窗 → 但 `setFloatState('idle')` 触发渲染器切换到 idle 状态
- idle 状态显示的是 CircularBubble（录音框），导致短暂闪现或位置异常
- **预期**：注入后直接隐藏，不显示任何 UI
- **状态**：已修复 — 4 个注入路径（`llm:confirm-inject`、`polishWithSlot`、`confirm-inject`/`inject-polished` hotkey、`inject:request`）均直接调用 `hideFloatWindow()`，不切换 state。

### Bug 2: 预览页面初始高度过大
- 刚进入预览时，内容只有识别原文（一两行），但窗口高度默认 220px+
- 下半部分大量空白
- **预期**：初始高度紧凑（如 160px），随 AI 优化文本行数增加逐渐长高
- **状态**：已修复 — `FloatBubble/index.tsx` 初始 `previewHeight: 160`，已优化后 `Math.max(220, Math.min(500, h))` 自适应。

### Bug 3: Ctrl+1 重新唤醒时录音框位置偏移
- 注入后隐藏 → 预览状态窗口是 800×400，hide 时保持此尺寸
- 再次 show 时先以大尺寸出现，然后 resize IPC 才触发缩小
- 导致短暂闪现 + 位置计算不准确
- **修复**：startRecording 时先 `setSize(520, 140)` + `setPosition()` 再 `show()`
- **状态**：已修复 — `startRecording` 在 `show()` 前已 setSize + setPosition；`hideFloatWindow` 也会先 setSize 再 hide。

---

## 6. 引擎目录布局

```
bin/
├── whisper-cli.exe    # 主程序 (489 KB)
├── whisper.dll        # whisper 核心库
├── ggml.dll           # ggml 运行时
├── ggml-base.dll
└── ggml-cpu.dll
```

通过 `electron-builder.yml` 的 `extraResources` 打包到 `resources/bin/`。
运行时 `LocalASRClient.findWhisperBinary()` 优先查找此路径。
开发环境 fallback 到 `<appPath>/bin/whisper-cli.exe`。

开发时更新引擎：`node scripts/download-engine.mjs`。
