import type {
  ChatCompletionsResponse,
  ChatCompletionChunk,
  ResponsesApiResponse,
  ResponseSSEEvent,
  InputMessageItem,
  FunctionCallItem,
  ResponseItem,
} from "../types.js";
import { randomUUID } from "crypto";

function makeResponseId(): string {
  return `resp_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function makeItemId(): string {
  return `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function buildBaseResponse(
  id: string,
  model: string,
  status: ResponsesApiResponse["status"],
  output: ResponseItem[] = [],
  usage?: ChatCompletionsResponse["usage"],
): ResponsesApiResponse {
  return {
    id,
    object: "response",
    created_at: nowSeconds(),
    model,
    status,
    output,
    usage: usage
      ? {
          input_tokens: usage.prompt_tokens,
          output_tokens: usage.completion_tokens,
          total_tokens: usage.total_tokens,
          input_tokens_details: usage.prompt_tokens_details
            ? { cached_tokens: usage.prompt_tokens_details.cached_tokens }
            : undefined,
          output_tokens_details: usage.completion_tokens_details
            ? { reasoning_tokens: usage.completion_tokens_details.reasoning_tokens }
            : undefined,
        }
      : undefined,
    parallel_tool_calls: true,
    tool_choice: "auto",
  };
}

// ============================================================
// 非流式翻译
// ============================================================

export function translateChatResponseToResponses(
  chatResp: ChatCompletionsResponse,
): ResponsesApiResponse {
  const responseId = makeResponseId();
  const output: ResponseItem[] = [];

  for (const choice of chatResp.choices) {
    const msg = choice.message;

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        output.push({
          type: "function_call",
          id: makeItemId(),
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
          status: "completed",
        });
      }
    } else {
      const raw = msg.content;
      const text = typeof raw === "string"
        ? raw
        : Array.isArray(raw)
          ? raw.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("")
          : "";

      output.push({
        type: "message",
        id: makeItemId(),
        role: "assistant",
        content: [{ type: "output_text", text }],
        status: "completed",
      });
    }
  }

  return buildBaseResponse(responseId, chatResp.model, "completed", output, chatResp.usage);
}

// ============================================================
// SSE 流式翻译
// ============================================================

export function serializeSSEEvent(event: ResponseSSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

interface ToolCallState {
  itemId: string;
  callId: string;
  name: string;
  argumentsBuf: string;
  outputIndex: number;
}

/**
 * SSE 流式翻译状态机
 *
 * 将 Chat Completions SSE chunk 序列翻译为 Responses API SSE 事件序列。
 * 调用方通过 drainEvents() 取出已翻译的事件。
 */
export class ChatToResponsesSSETranslator {
  private responseId: string;
  private model: string;
  private outputIndex = 0;

  private textItemId = "";
  private accumulatedText = "";
  private textItemStarted = false;

  private toolCallStates = new Map<number, ToolCallState>();
  private usage: ChatCompletionChunk["usage"] | undefined;
  private eventBuffer: ResponseSSEEvent[] = [];

  constructor(model: string) {
    this.responseId = makeResponseId();
    this.model = model;
  }

  start(): void {
    const skeleton = buildBaseResponse(this.responseId, this.model, "in_progress");
    this.emit({ type: "response.created", response: skeleton });
    this.emit({ type: "response.in_progress", response: skeleton });
  }

  processChunk(chunk: ChatCompletionChunk): void {
    if (chunk.usage) this.usage = chunk.usage;

    for (const choice of chunk.choices) {
      const { delta, finish_reason } = choice;

      if (delta.content != null && delta.content !== "") {
        this.ensureTextItemStarted();
        this.accumulatedText += delta.content;
        this.emit({
          type: "response.output_text.delta",
          item_id: this.textItemId,
          output_index: this.outputIndex,
          content_index: 0,
          delta: delta.content,
        });
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = this.toolCallStates.get(tc.index);
          if (existing) {
            // 已有工具调用 → 追加参数增量
            const argsDelta = tc.function?.arguments ?? "";
            if (argsDelta) {
              existing.argumentsBuf += argsDelta;
              this.emit({
                type: "response.function_call_arguments.delta",
                item_id: existing.itemId,
                output_index: existing.outputIndex,
                call_id: existing.callId,
                delta: argsDelta,
              });
            }
          } else {
            // 新工具调用 → 先关闭文本
            if (this.textItemStarted) this.closeTextItem();

            const state: ToolCallState = {
              itemId: makeItemId(),
              callId: tc.id ?? makeItemId(),
              name: tc.function?.name ?? "",
              argumentsBuf: tc.function?.arguments ?? "",
              outputIndex: this.outputIndex,
            };
            this.toolCallStates.set(tc.index, state);

            this.emit({
              type: "response.output_item.added",
              output_index: this.outputIndex,
              item: {
                type: "function_call",
                id: state.itemId,
                call_id: state.callId,
                name: state.name,
                arguments: "",
                status: "in_progress",
              },
            });

            if (state.argumentsBuf) {
              this.emit({
                type: "response.function_call_arguments.delta",
                item_id: state.itemId,
                output_index: state.outputIndex,
                call_id: state.callId,
                delta: state.argumentsBuf,
              });
            }

            this.outputIndex += 1;
          }
        }
      }

      if (finish_reason) this.closeAllOpenItems();
    }
  }

  finish(): void {
    this.closeAllOpenItems();

    const output: ResponseItem[] = [];

    if (this.accumulatedText || this.textItemStarted) {
      output.push({
        type: "message",
        id: this.textItemId || makeItemId(),
        role: "assistant",
        content: [{ type: "output_text", text: this.accumulatedText }],
        status: "completed",
      });
    }

    for (const [, s] of this.toolCallStates) {
      output.push({
        type: "function_call",
        id: s.itemId,
        call_id: s.callId,
        name: s.name,
        arguments: s.argumentsBuf,
        status: "completed",
      });
    }

    const finalResponse = buildBaseResponse(
      this.responseId, this.model, "completed", output,
      this.usage
        ? { prompt_tokens: this.usage.prompt_tokens, completion_tokens: this.usage.completion_tokens, total_tokens: this.usage.total_tokens }
        : undefined,
    );
    this.emit({ type: "response.completed", response: finalResponse });
  }

  emitError(code: string, message: string): void {
    this.emit({ type: "error", code, message });
    const failed = buildBaseResponse(this.responseId, this.model, "failed");
    failed.error = { code, message };
    this.emit({ type: "response.failed", response: failed });
  }

  drainEvents(): ResponseSSEEvent[] {
    const events = this.eventBuffer;
    this.eventBuffer = [];
    return events;
  }

  // ---- private ----

  private emit(event: ResponseSSEEvent): void {
    this.eventBuffer.push(event);
  }

  private ensureTextItemStarted(): void {
    if (this.textItemStarted) return;
    this.textItemId = makeItemId();
    this.textItemStarted = true;

    this.emit({
      type: "response.output_item.added",
      output_index: this.outputIndex,
      item: {
        type: "message",
        id: this.textItemId,
        role: "assistant",
        content: [],
        status: "in_progress",
      },
    });
    this.emit({
      type: "response.content_part.added",
      item_id: this.textItemId,
      output_index: this.outputIndex,
      content_index: 0,
      part: { type: "output_text", text: "" },
    });
  }

  private closeTextItem(): void {
    if (!this.textItemStarted) return;

    this.emit({
      type: "response.output_text.done",
      item_id: this.textItemId,
      output_index: this.outputIndex,
      content_index: 0,
      text: this.accumulatedText,
    });
    this.emit({
      type: "response.content_part.done",
      item_id: this.textItemId,
      output_index: this.outputIndex,
      content_index: 0,
      part: { type: "output_text", text: this.accumulatedText },
    });
    this.emit({
      type: "response.output_item.done",
      output_index: this.outputIndex,
      item: {
        type: "message",
        id: this.textItemId,
        role: "assistant",
        content: [{ type: "output_text", text: this.accumulatedText }],
        status: "completed",
      },
    });

    this.outputIndex += 1;
    this.textItemStarted = false;
    this.accumulatedText = "";
  }

  private closeToolCalls(): void {
    for (const [, s] of this.toolCallStates) {
      this.emit({
        type: "response.function_call_arguments.done",
        item_id: s.itemId,
        output_index: s.outputIndex,
        call_id: s.callId,
        arguments: s.argumentsBuf,
      });
      this.emit({
        type: "response.output_item.done",
        output_index: s.outputIndex,
        item: {
          type: "function_call",
          id: s.itemId,
          call_id: s.callId,
          name: s.name,
          arguments: s.argumentsBuf,
          status: "completed",
        },
      });
    }
  }

  private closeAllOpenItems(): void {
    if (this.textItemStarted) this.closeTextItem();
    this.closeToolCalls();
    this.toolCallStates.clear();
  }
}

// ============================================================
// SSE 解析
// ============================================================

/** 解析 Chat Completions SSE 行。返回 chunk / null([DONE]) / undefined(跳过) */
export function parseChatSSELine(line: string): ChatCompletionChunk | null | undefined {
  if (!line.startsWith("data:")) return undefined;
  const payload = line.slice(5).trim();
  if (payload === "[DONE]") return null;
  try {
    return JSON.parse(payload) as ChatCompletionChunk;
  } catch {
    return undefined;
  }
}
