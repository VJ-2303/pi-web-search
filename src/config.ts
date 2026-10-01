import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface SearxngConfig {
  endpoint: string;
  apiKey?: string;
  categories?: string;
  defaultEngines?: string;
  timeoutMs?: number;
}

const DEFAULT_CONFIG: SearxngConfig = {
  endpoint: "http://localhost:8080",
  apiKey: "",
  categories: "general",
  defaultEngines: "google,bing",
  timeoutMs: 10000,
};

export function getDefaultConfigPath(): string {
  return path.join(os.homedir(), ".pi", "agent", "searxng.json");
}

export function ensureConfigFile(configPath?: string): string {
  const resolvedPath = configPath || getDefaultConfigPath();
  if (!fs.existsSync(resolvedPath)) {
    const parentDir = path.dirname(resolvedPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(resolvedPath, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");
  }
  return resolvedPath;
}

export function loadConfig(configPath?: string): SearxngConfig {
  const resolvedPath = configPath || getDefaultConfigPath();

  if (!fs.existsSync(resolvedPath)) {
    ensureConfigFile(resolvedPath);
    throw new Error(
      `SearXNG config not found. Created template at: ${resolvedPath}\nPlease update the endpoint in the config file.`
    );
  }

  const raw = fs.readFileSync(resolvedPath, "utf-8");
  const parsed = JSON.parse(raw);

  if (!parsed.endpoint || typeof parsed.endpoint !== "string") {
    throw new Error(`Invalid SearXNG config in ${resolvedPath}: missing or invalid "endpoint"`);
  }

  return {
    ...parsed,
    endpoint: parsed.endpoint.replace(/\/+$/, ""),
  };
}

export function saveConfig(config: SearxngConfig, configPath?: string): void {
  const resolvedPath = configPath || getDefaultConfigPath();
  if (!config.endpoint || typeof config.endpoint !== "string" || config.endpoint.trim().length === 0) {
    throw new Error("Invalid endpoint: must be a non-empty URL string");
  }

  const parentDir = path.dirname(resolvedPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  const sanitized: SearxngConfig = {
    endpoint: config.endpoint.trim().replace(/\/+$/, ""),
    apiKey: config.apiKey?.trim() || "",
    categories: config.categories?.trim() || "general",
    defaultEngines: config.defaultEngines?.trim() || "",
    timeoutMs:
      typeof config.timeoutMs === "number" && config.timeoutMs > 0 ? config.timeoutMs : 10000,
  };

  fs.writeFileSync(resolvedPath, JSON.stringify(sanitized, null, 2), "utf-8");
}

