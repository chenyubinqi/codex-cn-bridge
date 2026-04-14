# Codex CN Bridge

将 **Codex CLI 0.8+** 接上国内大模型的本地代理服务器。

Codex 0.8+ 使用 OpenAI **Responses API**（`POST /v1/responses`），而国内大模型（DeepSeek、Qwen、Kimi、智谱 GLM 等）只提供 **Chat Completions API**（`POST /v1/chat/completions`）。本工具在两者之间做双向协议翻译，支持流式 SSE、工具调用（Function Calling）等完整特性。

## 架构

```
Codex CLI 0.8+
  ↓ POST /v1/responses (Responses API SSE)
[Bridge Server :8088]
  ↓ POST /v1/chat/completions (Chat Completions SSE)
国内大模型 (DeepSeek / Qwen / Kimi / 智谱 ...)
```

## 快速开始

### 1. 安装

```bash
# 克隆仓库
git clone <repo-url> codex-cn-bridge
cd codex-cn-bridge

npm install
npm run build
```

### 2. 配置

复制并编辑配置文件：

```bash
cp config.yaml ~/.codex-cn-bridge.yaml
```

编辑 `~/.codex-cn-bridge.yaml`，填入 API Key 和选择 provider：

```yaml
provider: deepseek   # 当前使用的 provider

providers:
  deepseek:
    base_url: https://api.deepseek.com/v1
    api_key: sk-your-deepseek-key
    model_map:
      "*": deepseek-chat
```

也可以通过环境变量配置（无需配置文件）：

```bash
export BRIDGE_PROVIDER=deepseek
export BRIDGE_BASE_URL=https://api.deepseek.com/v1
export BRIDGE_API_KEY=sk-your-key
export BRIDGE_MODEL=deepseek-chat
```

### 3. 启动 Bridge

```bash
# 开发模式
npm run dev

# 生产模式（先构建）
npm run build
npm start

# 或直接用 npx（全局安装后）
codex-cn-bridge
```

默认监听 `http://127.0.0.1:8088`。

### 4. 配置 Codex

编辑 `~/.codex/config.toml`，将 provider 指向本地 bridge：

```toml
[model]
model = "deepseek-chat"    # 对应 config.yaml 中 model_map 的 key

[[provider]]
name = "cn-bridge"
base_url = "http://127.0.0.1:8088/v1"
env_key = "BRIDGE_API_KEY"   # 随便设一个名字，bridge 不校验 key
wire_api = "responses"
```

同时在 shell 中设置对应的环境变量（值随意，bridge 不做校验）：

```bash
export BRIDGE_API_KEY=any-value
```

### 5. 启动 Codex

```bash
codex
```

## 支持的国内大模型

| Provider | base_url | 模型示例 |
|---|---|---|
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat`, `deepseek-reasoner` |
| 通义千问 (Qwen) | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus`, `qwen-turbo`, `qwen-max` |
| Moonshot (Kimi) | `https://api.moonshot.cn/v1` | `moonshot-v1-8k`, `moonshot-v1-128k` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash`, `glm-4-plus` |
| 火山引擎方舟 Code Plan | `https://ark.cn-beijing.volces.com/api/coding/v3` | `ark-code-latest`（Auto 模式，按效果+速度智能选模型）|
| 火山引擎方舟 (Doubao) | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-pro-32k`, `doubao-pro-128k`, 推理接入点 ID |
| 任意兼容 OpenAI Chat Completions 的服务 | 自定义 | 自定义 |

> 本地 Ollama 也支持：`base_url: http://localhost:11434/v1`，`api_key: ollama`

## 翻译细节

### 请求翻译

| Responses API 字段 | Chat Completions 字段 |
|---|---|
| `instructions` | `messages[0]`（role: system）|
| `input[]`（消息/工具调用/工具结果） | `messages[]` |
| `tools[].type === "function"` | `tools[]`（function 定义）|
| `web_search_preview` / `file_search` | 忽略（国内 LLM 不支持）|
| `text.format` | `response_format` |
| `max_output_tokens` | `max_tokens` |

### 响应 SSE 事件序列

Chat Completions `data: {...choices[].delta...}` 被翻译为完整的 Responses API 事件序列：

```
response.created
response.in_progress
response.output_item.added       ← message item 开始
response.content_part.added      ← 文本 part 开始
response.output_text.delta       ← 逐 token 文本增量（每个 chunk 一条）
...（重复 output_text.delta）
response.output_text.done        ← 文本生成结束
response.content_part.done
response.output_item.done
response.completed               ← 含完整 usage
```

工具调用时额外发出：

```
response.output_item.added       ← function_call item
response.function_call_arguments.delta   ← arguments 增量
response.function_call_arguments.done
response.output_item.done
```

## 环境变量参考

| 变量 | 说明 | 默认值 |
|---|---|---|
| `BRIDGE_CONFIG` | 配置文件路径 | 自动搜索 |
| `BRIDGE_PORT` | 监听端口 | `8088` |
| `BRIDGE_HOST` | 监听地址 | `127.0.0.1` |
| `BRIDGE_PROVIDER` | Provider 名称（无配置文件时使用）| `deepseek` |
| `BRIDGE_BASE_URL` | 上游 base_url（无配置文件时使用）| `https://api.deepseek.com/v1` |
| `BRIDGE_API_KEY` | 上游 API Key（无配置文件时使用）| — |
| `BRIDGE_MODEL` | 上游模型名（无配置文件时使用）| `deepseek-chat` |

## 构建可执行文件

```bash
npm run build
# 生成 dist/index.js，可以 node dist/index.js 运行
```

## 故障排查

**Codex 连接失败**：确认 bridge 正常运行，`curl http://127.0.0.1:8088/health` 应返回 `{"status":"ok",...}`。

**上游返回 401**：检查 config.yaml 中的 `api_key` 是否正确，或对应的环境变量是否已设置。

**模型不存在**：检查 `model_map` 配置，确保 Codex 使用的模型名有对应映射。

**工具调用不工作**：部分国内 LLM（如免费版 Qwen）不支持 Function Calling，请切换到付费版本或支持工具调用的模型。
