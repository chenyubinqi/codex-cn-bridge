import express from "express";
import { request as undiciRequest } from "undici";
import { handleResponses } from "./handlers/responses.js";
import { loadConfig, getActiveProvider } from "./config.js";

export function createServer() {
  const app = express();

  app.use(express.json({ limit: "10mb" }));

  app.get("/health", (_req, res) => {
    const config = loadConfig();
    res.json({
      status: "ok",
      provider: config.provider,
      providers: Object.keys(config.providers),
    });
  });

  app.post("/v1/responses", (req, res) => {
    handleResponses(req, res).catch((err: unknown) => {
      console.error("[bridge] unhandled error in /v1/responses", err);
      if (!res.headersSent) {
        res.status(500).json({ error: { message: String(err), type: "bridge_error" } });
      }
    });
  });

  app.post("/v1/chat/completions", (req, res) => {
    const config = loadConfig();
    const provider = getActiveProvider(config);
    const upstreamUrl = `${provider.base_url.replace(/\/$/, "")}/chat/completions`;

    undiciRequest(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.api_key}`,
        Accept: req.headers["accept"] as string ?? "application/json",
      },
      body: JSON.stringify(req.body),
    }).then(({ statusCode, body: upstream }) => {
      res.status(statusCode);
      upstream.pipe(res);
    }).catch((err: unknown) => {
      res.status(500).json({ error: { message: String(err) } });
    });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: { message: "Not found", type: "not_found" } });
  });

  return app;
}
