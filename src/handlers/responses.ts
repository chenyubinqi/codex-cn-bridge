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

  if (chatReq.stream !== false) {
    await handleStreaming(res, upstreamUrl, providerCfg.api_key, chatReq, resolvedModel);
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
  res: Response, url: string, apiKey: string, chatReq: ChatCompletionsRequest, model: string
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
    let currentEvent = ""; // accumulate multi-line data events
    for await (const chunk of body) {
      buf += typeof chunk === "string" ? chunk : (chunk as Buffer).toString("utf-8");
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trimEnd();
        if (!trimmed) {
          // end of event - parse accumulated data
          if (currentEvent) {
            const parsed = parseChatSSELine(currentEvent);
            if (parsed === null) { translator.finish(); flush(); }
            else if (parsed !== undefined) { translator.processChunk(parsed as ChatCompletionChunk); flush(); }
            currentEvent = "";
          }
          continue;
        }
        // append to current event (strip "data: " prefix only on first line)
        if (trimmed.startsWith("data:")) {
          if (currentEvent) {
            // already have some data - append after space
            currentEvent += " " + trimmed.slice(5).trim();
          } else {
            currentEvent = trimmed;
          }
        } else if (currentEvent) {
          // continuation line without data: prefix (common in multi-line JSON)
          currentEvent += " " + trimmed.trim();
        }
        // ignore non-data lines
      }
    }

    // handle any remaining event at end of stream
    if (currentEvent) {
      const parsed = parseChatSSELine(currentEvent);
      if (parsed === null) { translator.finish(); flush(); }
      else if (parsed !== undefined) { translator.processChunk(parsed as ChatCompletionChunk); flush(); }
    }

    // ensure finish is always called
    translator.finish();
    flush();

    if (buf.trim()) {
      // handle any remaining buffer that wasn't part of a complete event
      // but we already called finish above to ensure completion
    }
  } catch (err) {
    log("error", "streaming failed", String(err));
    translator.emitError("bridge_error", String(err));
    flush();
  } finally {
    res.end();
  }
}
