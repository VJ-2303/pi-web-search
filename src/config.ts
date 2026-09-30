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
  defaultEngines: "",
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
