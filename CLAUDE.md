# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Node.js CLI 构建运行：**
- `npm install` - 安装依赖
- `npm run build` - 构建 Node.js CLI 到 `dist/index.js`
- `npm run dev` - 开发模式（tsx watch 自动重启）
- `npm start` - 运行构建后的服务
- `npm run typecheck` - TypeScript 类型检查

**Electron 菜单栏应用：**
- `npm run build:electron` - 构建 Electron 主进程代码到 `electron/dist/main.js`
- `npm run package:mac` - 完整构建打包 macOS DMG（先构建 Node.js + Electron，然后 electron-builder）
- 输出 DMG 在 `release/Codex CN Bridge-0.1.0-arm64.dmg`

## Architecture

**项目用途：** Codex 0.8+ Responses API ↔ Chat Completions 协议桥接，让 Codex CLI 可以使用国内大模型。

### 核心代码结构

```
src/
├── index.ts           - CLI 入口，加载配置启动 Express 服务
├── config.ts          - 配置加载，支持多路径搜索 YAML + 环境变量占位符展开
├── server.ts          - Express 服务器创建和路由定义
├── types.ts           - TypeScript 类型定义（Responses API + Chat Completions）
├── handlers/
│   └── responses.ts    - /v1/responses 端点处理
└── translators/
    ├── request.ts      - Responses → Chat Completions 请求翻译
    └── response.ts     - Chat Completions → Responses SSE 响应翻译

electron/
├── main.ts            - Electron 主进程（菜单栏应用入口）
├── assets/            - 状态栏图标 (green/gray) + app icon
└── dist/              - 编译后的 Electron 代码
```

### 协议转换流程

```
Codex CLI → POST /v1/responses (Responses API SSE)
       ↓
[Codex CN Bridge :8088]
  ↓ (request translator: Responses → Chat Completions)
  POST /v1/chat/completions (Chat Completions SSE)
       ↓
国内大模型 API
       ↓
  SSE 流返回
  ↓ (response translator: Chat Completions → Responses SSE)
 Codex CLI ←  Responses 格式 SSE 事件流
```

### 关键模块职责

| 模块 | 功能 |
|------|------|
| `config.ts` | 按优先级搜索加载配置：`BRIDGE_CONFIG` env → `~/.codex-cn-bridge.yaml` → `~/.config/...` → `./.codex-cn-bridge.yaml` → `./config.yaml` → 纯环境变量 |
| `request.ts` | 将 Responses API 格式转换为 Chat Completions：`instructions` → system message，`input[]` → messages，`tools` → tools 保留，`web_search/file_search` 忽略 |
| `response.ts` | 状态机实现，将 Chat Completions SSE 增量转换为 Responses SSE 事件序列，支持文本增量和工具调用增量 |
| `responses.ts` | 入口处理器，协调翻译、上游调用、流式输出 |

### Electron 菜单栏应用

- **入口：** `electron/main.ts`
- **行为：** 应用启动后只在 macOS 状态栏显示，Dock 图标隐藏
- **图标状态：** 绿色 = 运行中，灰色 = 已停止
- **菜单功能：** 一键启停服务，打开配置文件（自动创建默认配置）
- **打包配置：** `package.json` → `build.extraResources` 包含 `electron/assets/` 和 `dist/`，确保资源正确打包
- **node 查找：** 打包后自动搜索 `/opt/homebrew/bin/node` 等常见路径启动桥接服务

### Configuration Search Order

1. `$BRIDGE_CONFIG` 环境变量指定路径
2. `~/.codex-cn-bridge.yaml`
3. `~/.config/codex-cn-bridge/config.yaml`
4. `./.codex-cn-bridge.yaml`
5. `./config.yaml`
6. 无文件 → 使用环境变量 `BRIDGE_PROVIDER`, `BRIDGE_BASE_URL`, `BRIDGE_API_KEY`, `BRIDGE_MODEL`

### Supported Models

- DeepSeek
- 通义千问 (Qwen)
- Moonshot (Kimi)
- 智谱 GLM
- 火山引擎方舟
- Ollama (本地模型)
- 任意兼容 OpenAI Chat Completions API 的服务

## Entry Points

- **CLI 命令行：** `dist/index.js` (由 `src/index.ts` 构建) → `package.json#bin`
- **Electron 应用：** `electron/dist/main.js` (由 `electron/main.ts` 构建) → `package.json#main` 当打包 Electron 时需要改为这个路径

## Notes

- 使用 esbuild 构建，不输出 .d.ts，快速增量构建
- 目标 Node.js 版本: Node 20+
- 支持流式 SSE 和 Function Calling 增量输出
- model_map 机制: Codex 请求的模型名 → 上游实际模型名，支持 `*` fallback
