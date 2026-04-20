import type { Request, Response } from "express";
import { request as undiciRequest } from "undici";
import type {
  ResponsesApiRequest,
  ChatCompletionsRequest,
  ChatCompletionsResponse,
  ChatCompletionChunk,
} from "../types.js";
import { loadConfig, resolveModel } from "../config.js";
import { translateRequestToChatCompletions } from "../translators/request.js";
import {
  translateChatResponseToResponses,
  ChatToResponsesSSETranslator,
  parseChatSSELine,
  serializeSSEEvent,
} from "../translators/response.js";

function log(level: string, msg: string, data?: unknown): void {
  const prefix = `[bridge][${new Date().toISOString()}][${level}]`;
  if (data !== undefined) {
    console.log(prefix, msg, typeof data === "object" ? JSON.stringify(data) : data);
  } else {
    console.log(prefix, msg);
  }
}

export async function handleResponses(req: Request, res: Response): Promise<void> {
  const config = loadConfig();
  const body = req.body as ResponsesApiRequest;
  const requestedModel = body.model ?? "default";

  // mini 模型路由
  const miniPattern = new RegExp(config.mini_model_pattern ?? "mini");
  const isMiniModel = miniPattern.test(requestedModel);
  const providerName = isMiniModel && config.mini_provider ? config.mini_provider : config.provider;
  const providerCfg = config.providers[providerName];
  if (!providerCfg) {
    res.status(500).json({ error: { message: `Provider "${providerName}" not found` } });
    return;
  }

  const resolvedModel = resolveModel(requestedModel, providerCfg.model_map);
  log("info", `→ ${requestedModel} → ${resolvedModel} @${providerName}${isMiniModel ? " [mini]" : ""}`);

  const chatReq = translateRequestToChatCompletions(body, resolvedModel);

  if (config.log_level === "debug") {
    if (body.previous_response_id) {
      log("warn", `previous_response_id="${body.previous_response_id}" ignored (stateless bridge)`);
    }
    const userMsg = Array.isArray(body.input)
      ? body.input.find((item: any) => item.type === "message" && item.role === "user")
      : null;
    if (userMsg && "content" in userMsg) {
      const text = typeof userMsg.content === "string"
        ? userMsg.content
        : Array.isArray(userMsg.content)
          ? userMsg.content.filter((p: any) => ["text", "input_text", "output_text"].includes(p.type)).map((p: any) => p.text).join("")
          : "";
      log("debug", `User: "${text.slice(0, 200)}${text.length > 200 ? "..." : ""}"`);
    }
    log("debug", `→ ${chatReq.messages.length} msgs, ${chatReq.tools?.length ?? 0} tools`);
  }

  const upstreamUrl = `${providerCfg.base_url.replace(/\/$/, "")}/chat/completions`;

  const debug = config.log_level === "debug";

  if (chatReq.stream !== false) {
    await handleStreaming(res, upstreamUrl, providerCfg.api_key, chatReq, resolvedModel, debug);
  } else {
    await handleSync(res, upstreamUrl, providerCfg.api_key, chatReq);
  }
}

async function handleSync(
  res: Response, url: string, apiKey: string, chatReq: ChatCompletionsRequest
): Promise<void> {
  try {
    const { statusCode, body } = await undiciRequest(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(chatReq),
    });
    const raw = await body.text();
    if (statusCode !== 200) {
      log("error", `upstream ${statusCode}`, raw);
      res.status(statusCode).json({ error: { message: raw, type: "upstream_error", code: String(statusCode) } });
      return;
    }
    res.json(translateChatResponseToResponses(JSON.parse(raw) as ChatCompletionsResponse));
  } catch (err) {
    log("error", "request failed", String(err));
    res.status(500).json({ error: { message: String(err), type: "bridge_error" } });
  }
}

async function handleStreaming(
  res: Response, url: string, apiKey: string, chatReq: ChatCompletionsRequest, model: string, debug: boolean
): Promise<void> {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const translator = new ChatToResponsesSSETranslator(model);
  const flush = () => {
    for (const event of translator.drainEvents()) res.write(serializeSSEEvent(event));
  };

  try {
    const { statusCode, body } = await undiciRequest(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        Accept: "text/event-stream",
      },
      body: JSON.stringify(chatReq),
      // 长任务（代码生成/规划）可能无输出超过默认超时窗口，关闭超时避免被提前中断。
      headersTimeout: 0,
      bodyTimeout: 0,
    });

    if (statusCode !== 200) {
      const errorBody = await body.text();
      log("error", `upstream ${statusCode}`, errorBody);
      translator.emitError(String(statusCode), `Upstream error: ${errorBody}`);
      flush();
      res.end();
      return;
    }

    translator.start();
    flush();

    let buf = "";
    let currentEventLines: string[] = [];
    let upstreamDone = false;
    let sawTerminalFinishReason = false;
    const parseEventPayload = (payload: string): ChatCompletionChunk | null | undefined => {
      // 标准路径
      const direct = parseChatSSELine(`data: ${payload}`);
      if (direct !== undefined) return direct;

      // 兼容部分上游对多行 data 的非标准切分：尝试无分隔拼接
      if (payload.includes("\n")) {
        const compact = payload.replace(/\n/g, "");
        const compactParsed = parseChatSSELine(`data: ${compact}`);
        if (compactParsed !== undefined) return compactParsed;

        // 再尝试空白拼接
        const spaced = payload.replace(/\n+/g, " ");
        const spacedParsed = parseChatSSELine(`data: ${spaced}`);
        if (spacedParsed !== undefined) return spacedParsed;
      }

      return undefined;
    };
    const flushEvent = () => {
      if (currentEventLines.length === 0) return;
      const payload = currentEventLines.join("\n").trim();
      currentEventLines = [];
      if (!payload) return;

      // 标准 OpenAI SSE 结束标记
      if (payload === "[DONE]") {
        upstreamDone = true;
        translator.finish();
        flush();
        return;
      }

      // 常规：一个 event 对应一个 JSON。
      const parsed = parseEventPayload(payload);
      if (parsed !== undefined && parsed !== null) {
        if (debug) {
          for (const c of parsed.choices) {
            if (c.finish_reason) log("debug", `upstream finish_reason=${c.finish_reason}`);
          }
        }
        if (parsed.choices.some((c) => c.finish_reason != null)) sawTerminalFinishReason = true;
        translator.processChunk(parsed as ChatCompletionChunk);
        flush();
        return;
      }

      // 兼容：个别服务会把多个 JSON data 行塞进同一个 event（非标准但常见）。
      const lines = payload.split("\n").map((s) => s.trim()).filter(Boolean);
      let processedAny = false;
      for (const line of lines) {
        const each = parseChatSSELine(`data: ${line}`);
        if (each === null) {
          upstreamDone = true;
          translator.finish();
          flush();
          return;
        }
        if (each !== undefined) {
          processedAny = true;
          if (each.choices.some((c) => c.finish_reason != null)) sawTerminalFinishReason = true;
          translator.processChunk(each as ChatCompletionChunk);
        }
      }
      if (processedAny) {
        flush();
        return;
      }

      log("warn", "skip unparseable upstream SSE payload", payload.slice(0, 300));
    };

    outer: for await (const chunk of body) {
      buf += typeof chunk === "string" ? chunk : (chunk as Buffer).toString("utf-8");
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trimEnd();
        if (!trimmed) {
          flushEvent();
          if (upstreamDone) break outer;
          continue;
        }

        // 收集 data 行，兼容 continuation 行。
        if (trimmed.startsWith("data:")) {
          currentEventLines.push(trimmed.slice(5).trimStart());
        } else if (currentEventLines.length > 0) {
          // continuation line without data: prefix (common in multi-line JSON)
          currentEventLines.push(trimmed.trim());
        }
        // ignore non-data lines
      }
    }

    // handle any remaining event at end of stream
    flushEvent();

    // 若无 [DONE] 且也没见到 finish_reason，通常表示上游流异常中断。
    // 避免把不完整结果错误标记为 completed。
    if (!upstreamDone && !sawTerminalFinishReason) {
      log("warn", "upstream stream ended without terminal marker");
      translator.emitError("upstream_incomplete", "Upstream stream ended before completion marker");
      flush();
      return;
    }

    translator.finish();
    flush();

    const finalReason = translator.getLastFinishReason();
    log("info", `← finish_reason=${finalReason ?? "null"}${upstreamDone ? " [DONE]" : ""}`);
  } catch (err) {
    log("error", "streaming failed", String(err));
    translator.emitError("bridge_error", String(err));
    flush();
  } finally {
    res.end();
  }
}
