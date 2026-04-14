#!/usr/bin/env node
import { createServer } from "./server.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const port = config.port ?? 8088;
const host = process.env["BRIDGE_HOST"] ?? "127.0.0.1";

const app = createServer();

app.listen(port, host, () => {
  console.log(`[bridge] Codex CN Bridge running at http://${host}:${port}`);
  console.log(`[bridge] Active provider: ${config.provider}`);
  console.log(`[bridge] Available providers: ${Object.keys(config.providers).join(", ")}`);
  console.log();
  console.log(`[bridge] Configure Codex to use this bridge:`);
  console.log(`         Add to ~/.codex/config.toml:`);
  console.log();
  console.log(`           [model]`);
  console.log(`           model = "<your-model-name>"`);
  console.log();
  console.log(`           [[provider]]`);
  console.log(`           name = "cn-bridge"`);
  console.log(`           base_url = "http://${host}:${port}/v1"`);
  console.log(`           env_key = "BRIDGE_API_KEY"`);
  console.log(`           wire_api = "responses"`);
  console.log();
});

process.on("SIGINT", () => {
  console.log("\n[bridge] Shutting down...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n[bridge] Shutting down...");
  process.exit(0);
});
