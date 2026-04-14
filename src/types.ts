// ============================================================
// Responses API 类型定义（OpenAI Responses API 格式）
// ============================================================

export type ResponseItemRole = "user" | "assistant" | "system" | "developer";
export type ResponseItemStatus = "in_progress" | "completed" | "incomplete";

/** 文本内容部分（Responses API 中 input 用 "input_text"，output 用 "output_text"，也兼容 "text"） */
export interface TextContentPart {
  type: "text" | "input_text" | "output_text";
  text: string;
}

/** 输入图片内容部分 */
export interface ImageContentPart {
  type: "input_image";
  image_url?: { url: string; detail?: "auto" | "low" | "high" };
  file_id?: string;
}

/** 文件内容部分 */
export interface FileContentPart {
  type: "input_file";
  file_id?: string;
  filename?: string;
  file_data?: string;
}

export type ContentPart = TextContentPart | ImageContentPart | FileContentPart;

/** 输入消息 item */
export interface InputMessageItem {
  type: "message";
  id?: string;
  role: ResponseItemRole;
  content: string | ContentPart[];
  status?: ResponseItemStatus;
}

/** function_call item（模型发起工具调用） */
export interface FunctionCallItem {
  type: "function_call";
  id?: string;
  call_id: string;
  name: string;
  arguments: string;
  status?: ResponseItemStatus;
}

/** function_call_output item（用户返回工具结果） */
export interface FunctionCallOutputItem {
  type: "function_call_output";
  call_id: string;
  output: string;
  status?: ResponseItemStatus;
}

/** reasoning item（仅 o 系列模型） */
export interface ReasoningItem {
  type: "reasoning";
  id?: string;
  summary?: Array<{ type: "summary_text"; text: string }>;
  encrypted_content?: string;
  status?: ResponseItemStatus;
}

export type ResponseItem =
  | InputMessageItem
  | FunctionCallItem
  | FunctionCallOutputItem
  | ReasoningItem;

/** 工具定义（Responses API 格式） */
export interface FunctionToolDefinition {
  type: "function";
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}

export interface WebSearchToolDefinition {
  type: "web_search_preview";
}

export interface FileSearchToolDefinition {
  type: "file_search";
  vector_store_ids?: string[];
}

export type ToolDefinition =
  | FunctionToolDefinition
  | WebSearchToolDefinition
  | FileSearchToolDefinition;

/** Reasoning 配置 */
export interface ReasoningConfig {
  effort?: "low" | "medium" | "high";
  summary?: "auto" | "concise" | "detailed";
}

/** Text 格式控制 */
export interface TextControls {
  format?: { type: "text" } | { type: "json_object" } | { type: "json_schema"; json_schema: unknown };
}

/** Responses API 请求体（Codex 发来的） */
export interface ResponsesApiRequest {
  model: string;
  instructions?: string;
  input: string | ResponseItem[];
  tools?: ToolDefinition[];
  tool_choice?: "auto" | "none" | "required" | { type: "function"; name: string };
  parallel_tool_calls?: boolean;
  reasoning?: ReasoningConfig;
  store?: boolean;
  stream?: boolean;
  include?: string[];
  service_tier?: string;
  prompt_cache_key?: string;
  text?: TextControls;
  client_metadata?: Record<string, string>;
  previous_response_id?: string;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  truncation?: "auto" | "disabled";
}

/** Responses API 响应对象（非流式） */
export interface ResponsesApiResponse {
  id: string;
  object: "response";
  created_at: number;
  model: string;
  status: "completed" | "incomplete" | "in_progress" | "failed" | "cancelled";
  output: ResponseItem[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
  error?: { code: string; message: string };
  incomplete_details?: { reason: string } | null;
  instructions?: string;
  tools?: ToolDefinition[];
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number | null;
  service_tier?: string;
  parallel_tool_calls?: boolean;
  tool_choice?: unknown;
  text?: TextControls;
  reasoning?: ReasoningConfig;
  previous_response_id?: string | null;
  background?: boolean;
  metadata?: Record<string, unknown>;
}

// ============================================================
// Responses API SSE 事件类型
// ============================================================

export interface ResponseCreatedEvent {
  type: "response.created";
  response: ResponsesApiResponse;
}

export interface ResponseInProgressEvent {
  type: "response.in_progress";
  response: ResponsesApiResponse;
}

export interface ResponseOutputItemAddedEvent {
  type: "response.output_item.added";
  output_index: number;
  item: ResponseItem;
}

export interface ResponseContentPartAddedEvent {
  type: "response.content_part.added";
  item_id: string;
  output_index: number;
  content_index: number;
  part: ContentPart;
}

export interface ResponseOutputTextDeltaEvent {
  type: "response.output_text.delta";
  item_id: string;
  output_index: number;
  content_index: number;
  delta: string;
}

export interface ResponseOutputTextDoneEvent {
  type: "response.output_text.done";
  item_id: string;
  output_index: number;
  content_index: number;
  text: string;
}

export interface ResponseContentPartDoneEvent {
  type: "response.content_part.done";
  item_id: string;
  output_index: number;
  content_index: number;
  part: ContentPart;
}

export interface ResponseOutputItemDoneEvent {
  type: "response.output_item.done";
  output_index: number;
  item: ResponseItem;
}

export interface ResponseFunctionCallArgumentsDeltaEvent {
  type: "response.function_call_arguments.delta";
  item_id: string;
  output_index: number;
  call_id: string;
  delta: string;
}

export interface ResponseFunctionCallArgumentsDoneEvent {
  type: "response.function_call_arguments.done";
  item_id: string;
  output_index: number;
  call_id: string;
  arguments: string;
}

export interface ResponseCompletedEvent {
  type: "response.completed";
  response: ResponsesApiResponse;
}

export interface ResponseFailedEvent {
  type: "response.failed";
  response: ResponsesApiResponse;
}

export interface ResponseIncompleteEvent {
  type: "response.incomplete";
  response: ResponsesApiResponse;
}

export interface ErrorEvent {
  type: "error";
  code: string;
  message: string;
  param?: string;
}

export type ResponseSSEEvent =
  | ResponseCreatedEvent
  | ResponseInProgressEvent
  | ResponseOutputItemAddedEvent
  | ResponseContentPartAddedEvent
  | ResponseOutputTextDeltaEvent
  | ResponseOutputTextDoneEvent
  | ResponseContentPartDoneEvent
  | ResponseOutputItemDoneEvent
  | ResponseFunctionCallArgumentsDeltaEvent
  | ResponseFunctionCallArgumentsDoneEvent
  | ResponseCompletedEvent
  | ResponseFailedEvent
  | ResponseIncompleteEvent
  | ErrorEvent;

// ============================================================
// Chat Completions API 类型定义
// ============================================================

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatTextContentPart {
  type: "text";
  text: string;
}

export interface ChatImageContentPart {
  type: "image_url";
  image_url: { url: string; detail?: "auto" | "low" | "high" };
}

export type ChatContentPart = ChatTextContentPart | ChatImageContentPart;

export interface ChatFunctionCall {
  name: string;
  arguments: string;
}

export interface ChatToolCall {
  id: string;
  type: "function";
  function: ChatFunctionCall;
}

export interface ChatMessage {
  role: ChatRole;
  content: string | ChatContentPart[] | null;
  name?: string;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

export interface ChatFunctionDefinition {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}

export interface ChatToolDefinition {
  type: "function";
  function: ChatFunctionDefinition;
}

/** Chat Completions API 请求体 */
export interface ChatCompletionsRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ChatToolDefinition[];
  tool_choice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
  parallel_tool_calls?: boolean;
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  response_format?: { type: "text" | "json_object" } | { type: "json_schema"; json_schema: unknown };
  stop?: string | string[];
  n?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  logit_bias?: Record<string, number>;
  user?: string;
}

/** Chat Completions 非流式响应 */
export interface ChatCompletionsResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
    logprobs?: unknown;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  system_fingerprint?: string;
}

/** Chat Completions SSE 流式 chunk */
export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: ChatRole;
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: "function";
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
    logprobs?: unknown;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ============================================================
// Bridge 配置类型
// ============================================================

export interface ProviderConfig {
  base_url: string;
  api_key: string;
  model_map?: Record<string, string>;
}

export interface BridgeConfig {
  provider: string;
  /** Codex 内部轻量模型（如 gpt-5.4-mini）使用的 provider 名，不配则复用主 provider */
  mini_provider?: string;
  /** 匹配 mini 模型的正则（默认匹配 gpt-*-mini, o*-mini 等） */
  mini_model_pattern?: string;
  port?: number;
  log_level?: "debug" | "info" | "warn" | "error";
  providers: Record<string, ProviderConfig>;
}
