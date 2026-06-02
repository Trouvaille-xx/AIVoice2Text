# VoiceFlow 🎙️

> 桌面端语音输入助手 — 说话自动转文字，AI 帮你润色，一键注入到任何输入框。

基于 Electron + React + 腾讯云 ASR + LLM，Windows 平台全局快捷键语音输入工具。

## 特性

- **🎤 全局语音识别** — 任意应用内按 `Ctrl+Alt+Z` 开始说话，自动识别为中文
- **✨ AI 文本润色** — 对接 OpenAI 兼容 API，自动去口语化、修正语法、规范标点
- **⌨️ 快捷键驱动** — 纯快捷键操作，不碰鼠标不丢焦点，直接注入目标输入框
- **📋 三级注入策略** — UIA ValuePattern → 剪贴板 → SendInput，自动 fallback
- **🫧 毛玻璃悬浮窗** — 透明置顶浮窗，显示识别/润色结果，可拖拽
- **📝 历史记录** — 本地 SQLite 存储，支持回溯和重新注入
- **🔒 本地存储** — API Key 等敏感信息用系统安全存储加密

## 安装

### 下载预编译版本

从 [Releases](../../releases) 下载 `VoiceFlow-Setup-x.x.x.exe` 安装。

### 从源码构建

```bash
# 克隆
git clone https://github.com/<your-username>/voiceflow.git
cd voiceflow

# 安装依赖
npm install

# 开发模式
npm run dev

# 构建 exe
npm run build:win
```

## 配置

首次启动后在设置面板（`Ctrl+,`）中填入：

| 配置项 | 说明 |
|--------|------|
| **腾讯云 ASR** | AppId、SecretId、SecretKey（[开通语音识别服务](https://cloud.tencent.com/product/asr)） |
| **LLM API** | Base URL + API Key + Model（OpenAI / 兼容接口均可） |

所有敏感配置使用系统安全存储加密，不上传、不泄露。

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Alt+Z` | 按住说话 / 松开结束（推说模式） |
| `Ctrl+Alt+X` | 推说 + AI 优化 |
| `Ctrl+Alt+1` | 注入识别原文（焦点保持在目标窗口） |
| `Ctrl+Alt+2` | AI 润色后注入 |
| `Esc` | 取消 / 丢弃 |
| `Tab` | 切换注入模式（覆盖 / 追加） |
| `Ctrl+,` | 打开设置 |
| `Ctrl+Shift+H` | 历史记录 |

## 技术栈

| 层 | 技术 |
|----|------|
| 框架 | Electron 31 + electron-vite |
| UI | React 18 + Tailwind CSS + Framer Motion |
| 状态管理 | Zustand |
| 语音识别 | 腾讯云 ASR WebSocket v2（16kHz PCM） |
| AI 润色 | OpenAI 兼容 API（流式 SSE） |
| 注入 | PowerShell UIA + Clipboard + SendKeys |
| 存储 | electron-store + better-sqlite3 |

## 项目结构

```
src/
├── main/                  # Electron 主进程
│   ├── index.ts           # 窗口管理、IPC、录音流程
│   ├── hotkey.ts          # 全局快捷键注册
│   ├── asr/               # 腾讯云 ASR（鉴权签发 + WebSocket 客户端）
│   ├── llm/               # OpenAI 兼容 LLM 流式客户端
│   ├── injector/          # Windows 文本注入器
│   ├── history/           # SQLite 历史记录
│   └── config/            # 配置存储（敏感字段加密）
├── preload/               # Context Bridge API
├── renderer/              # React UI
│   ├── components/        # 浮窗 / 设置 / 历史面板
│   ├── hooks/             # 音频采集 hook
│   └── store/             # Zustand 状态
└── shared/                # 共享类型定义
```

## License

MIT
