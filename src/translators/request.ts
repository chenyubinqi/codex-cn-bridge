import type {
  ResponsesApiRequest,
  ResponseItem,
  InputMessageItem,
  FunctionCallItem,
  FunctionCallOutputItem,
  ContentPart,
  FunctionToolDefinition,
  ChatMessage,
  ChatToolDefinition,
  ChatContentPart,
  ChatCompletionsRequest,
} from "../types.js";

// ============================================================
// 内容转换
// ============================================================

function translateContentPart(part: ContentPart): ChatContentPart | null {
  switch (part.type) {
    case "text":
    case "input_text":
    case "output_text":
      return { type: "text", text: part.text };
    case "input_image": {
      const url = part.image_url?.url ?? part.file_id ?? "";
      return url ? { type: "image_url", image_url: { url, detail: part.image_url?.detail } } : null;
    }
    default:
      return null;
  }
}

function translateContent(content: string | ContentPart[]): string | ChatContentPart[] {
  if (typeof content === "string") return content;
  const parts = content.map(translateContentPart).filter((p): p is ChatContentPart => p !== null);
  if (parts.length > 0 && parts.every((p) => p.type === "text")) {
    return parts.map((p) => (p as { type: "text"; text: string }).text).join("");
  }
  return parts;
}

// ============================================================
// ResponseItem → ChatMessage
// ============================================================

function translateMessage(item: InputMessageItem): ChatMessage | null {
  const role = item.role === "developer" ? "system" : item.role;
  if (role !== "user" && role !== "assistant" && role !== "system") return null;
  return { role, content: translateContent(item.content) };
}

function translateFunctionCall(item: FunctionCallItem): ChatMessage {
  return {
    role: "assistant",
    content: null,
    tool_calls: [{
      id: item.call_id,
      type: "function",
      function: { name: item.name, arguments: item.arguments },
    }],
  };
}

function translateFunctionCallOutput(item: FunctionCallOutputItem): ChatMessage {
  return { role: "tool", content: item.output, tool_call_id: item.call_id };
}

function translateItems(items: ResponseItem[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const item of items) {
    switch (item.type) {
      case "message": {
        const msg = translateMessage(item);
        if (msg) messages.push(msg);
        break;
      }
      case "function_call":
        messages.push(translateFunctionCall(item));
        break;
      case "function_call_output":
        messages.push(translateFunctionCallOutput(item));
        break;
    }
  }
  return messages;
}

// ============================================================
// 工具定义转换
// ============================================================

function translateTool(tool: FunctionToolDefinition): ChatToolDefinition {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: tool.strict,
    },
  };
}

// ============================================================
// 主入口
// ============================================================

export function translateRequestToChatCompletions(
  req: ResponsesApiRequest,
  resolvedModel: string,
): ChatCompletionsRequest {
  const messages: ChatMessage[] = [];

  if (req.instructions?.trim()) {
    messages.push({ role: "system", content: req.instructions });
  }

  if (typeof req.input === "string") {
    if (req.input.trim()) messages.push({ role: "user", content: req.input });
  } else if (Array.isArray(req.input)) {
    messages.push(...translateItems(req.input));
  }

  const tools: ChatToolDefinition[] = [];
  if (req.tools) {
    for (const t of req.tools) {
      if (t.type === "function") tools.push(translateTool(t));
    }
  }

  let tool_choice: ChatCompletionsRequest["tool_choice"];
  if (req.tool_choice) {
    if (typeof req.tool_choice === "string") {
      tool_choice = req.tool_choice as "auto" | "none" | "required";
    } else if (req.tool_choice.type === "function") {
      tool_choice = { type: "function", function: { name: req.tool_choice.name } };
    }
  }

  let response_format: ChatCompletionsRequest["response_format"];
  if (req.text?.format) {
    const fmt = req.text.format;
    if (fmt.type === "json_object") {
      response_format = { type: "json_object" };
    } else if (fmt.type === "json_schema") {
      const schema = (fmt as { type: "json_schema"; json_schema?: unknown }).json_schema;
      response_format = schema ? { type: "json_schema", json_schema: schema } : { type: "json_object" };
    }
  }

  const chatReq: ChatCompletionsRequest = {
    model: resolvedModel,
    messages,
    stream: req.stream ?? true,
    stream_options: req.stream ? { include_usage: true } : undefined,
  };

  if (tools.length > 0) chatReq.tools = tools;
  if (tool_choice !== undefined) {
    chatReq.tool_choice = tool_choice;
  } else if (tools.length > 0) {
    // 对部分兼容端点，未显式设置 tool_choice 时可能忽略 tools。
    chatReq.tool_choice = "auto";
  }
  if (req.parallel_tool_calls !== undefined) {
    chatReq.parallel_tool_calls = req.parallel_tool_calls;
  } else if (tools.length > 0) {
    chatReq.parallel_tool_calls = true;
  }
  if (req.temperature !== undefined) chatReq.temperature = req.temperature;
  if (req.top_p !== undefined) chatReq.top_p = req.top_p;
  if (req.max_output_tokens !== undefined) chatReq.max_tokens = req.max_output_tokens;
  if (response_format !== undefined) chatReq.response_format = response_format;

  return chatReq;
}
