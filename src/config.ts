import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import type { BridgeConfig, ProviderConfig } from "./types.js";

function homedir(): string {
  return process.env["HOME"] ?? process.env["USERPROFILE"] ?? "/tmp";
}

function expandEnvVars(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.replace(/\$\{([^}]+)\}/g, (_, name: string) => process.env[name] ?? "");
  }
  if (Array.isArray(obj)) return obj.map(expandEnvVars);
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = expandEnvVars(v);
    }
    return result;
  }
  return obj;
}

const CONFIG_SEARCH_PATHS = [
  process.env["BRIDGE_CONFIG"] ?? "",
  path.join(homedir(), ".codex-cn-bridge.yaml"),
  path.join(homedir(), ".config", "codex-cn-bridge", "config.yaml"),
  path.join(process.cwd(), ".codex-cn-bridge.yaml"),
  path.join(process.cwd(), "config.yaml"),
];

let _config: BridgeConfig | null = null;

export function loadConfig(): BridgeConfig {
  if (_config) return _config;

  for (const filePath of CONFIG_SEARCH_PATHS) {
    if (!filePath || !fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, "utf-8");
    _config = expandEnvVars(yaml.load(raw)) as BridgeConfig;
    console.log(`[bridge] config loaded from ${filePath}`);
    return _config;
  }

  const providerName = process.env["BRIDGE_PROVIDER"] ?? "deepseek";
  console.warn("[bridge] no config file found, using env vars");

  _config = {
    provider: providerName,
    port: parseInt(process.env["BRIDGE_PORT"] ?? "8088", 10),
    log_level: "info",
    providers: {
      [providerName]: {
        base_url: process.env["BRIDGE_BASE_URL"] ?? "https://api.deepseek.com/v1",
        api_key: process.env["BRIDGE_API_KEY"] ?? process.env["DEEPSEEK_API_KEY"] ?? process.env["OPENAI_API_KEY"] ?? "",
        model_map: { "*": process.env["BRIDGE_MODEL"] ?? "deepseek-chat" },
      },
    },
  };
  return _config;
}

export function getActiveProvider(config: BridgeConfig): ProviderConfig & { name: string } {
  const name = config.provider;
  const cfg = config.providers[name];
  if (!cfg) {
    throw new Error(`provider "${name}" not found. Available: ${Object.keys(config.providers).join(", ")}`);
  }
  return { name, ...cfg };
}

export function resolveModel(requestedModel: string, modelMap?: Record<string, string>): string {
  if (!modelMap) return requestedModel;
  return modelMap[requestedModel] ?? modelMap["*"] ?? requestedModel;
}
