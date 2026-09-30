import { loadConfig, saveConfig, getDefaultConfigPath, type SearxngConfig } from "./config.js";
import { checkSearxngHealth } from "./searxng.js";

export interface CommandUI {
  select(title: string, options: string[], opts?: any): Promise<string | undefined>;
  input(title: string, placeholder?: string, opts?: any): Promise<string | undefined>;
  confirm(title: string, message: string, opts?: any): Promise<boolean>;
  notify(message: string, type?: "info" | "warning" | "error"): void;
}

export interface ExtensionCommandContext {
  ui: CommandUI;
}

export async function handleSearxngStatus(
  ctx: ExtensionCommandContext,
  configPath?: string
): Promise<void> {
  let config: SearxngConfig;
  try {
    config = loadConfig(configPath);
  } catch (err: any) {
    ctx.ui.notify(`Failed to load config: ${err.message}`, "error");
    return;
  }

  const result = await checkSearxngHealth(config);

  const statusLabel = result.healthy ? "Healthy (HTTP 200)" : `Unhealthy (${result.status ? "HTTP " + result.status : "No Response"})`;
  const jsonLabel = result.jsonEnabled ? "Enabled" : "Disabled (Missing in settings.yml)";

  const report = [
    `Endpoint:    ${config.endpoint}`,
    `Status:      ${statusLabel}`,
    `Latency:     ${result.latencyMs}ms`,
    `JSON API:    ${jsonLabel}`,
    `Message:     ${result.message}`,
  ].join("\n");

  ctx.ui.notify(result.message, result.healthy ? "info" : "error");
  await ctx.ui.confirm("SearXNG Health Status", report, { okText: "Close" });
}

export async function handleSearxngConfig(
  ctx: ExtensionCommandContext,
  configPath?: string
): Promise<void> {
  const targetPath = configPath || getDefaultConfigPath();
  let working: SearxngConfig;

  try {
    working = loadConfig(targetPath);
  } catch {
    working = {
      endpoint: "http://localhost:8080",
      apiKey: "",
      categories: "general",
      defaultEngines: "",
      timeoutMs: 10000,
    };
  }

  while (true) {
    const options = [
      `1. Endpoint: ${working.endpoint}`,
      `2. API Key: ${working.apiKey ? "***" : "(none)"}`,
      `3. Categories: ${working.categories || "(default)"}`,
      `4. Default Engines: ${working.defaultEngines || "(all)"}`,
      `5. Timeout: ${working.timeoutMs || 10000}ms`,
      "Test Connection",
      "Save & Exit",
      "Cancel",
    ];

    const selection = await ctx.ui.select("SearXNG Configuration", options);

    if (!selection || selection === "Cancel") {
      ctx.ui.notify("Configuration unchanged", "info");
      return;
    }

    if (selection === "Save & Exit") {
      try {
        saveConfig(working, targetPath);
        ctx.ui.notify(`Configuration saved to: ${targetPath}`, "info");
      } catch (err: any) {
        ctx.ui.notify(`Save failed: ${err.message}`, "error");
      }
      return;
    }

    if (selection === "Test Connection") {
      const res = await checkSearxngHealth(working);
      ctx.ui.notify(res.message, res.healthy ? "info" : "error");
      continue;
    }

    if (selection.startsWith("1. Endpoint")) {
      const val = await ctx.ui.input("Update Endpoint", working.endpoint);
      if (val !== undefined && val.trim().length > 0) {
        working.endpoint = val.trim();
      }
    } else if (selection.startsWith("2. API Key")) {
      const val = await ctx.ui.input("Update API Key (empty for none)", working.apiKey);
      if (val !== undefined) {
        working.apiKey = val.trim();
      }
    } else if (selection.startsWith("3. Categories")) {
      const val = await ctx.ui.input("Update Categories", working.categories);
      if (val !== undefined && val.trim().length > 0) {
        working.categories = val.trim();
      }
    } else if (selection.startsWith("4. Default Engines")) {
      const val = await ctx.ui.input("Update Default Engines", working.defaultEngines);
      if (val !== undefined) {
        working.defaultEngines = val.trim();
      }
    } else if (selection.startsWith("5. Timeout")) {
      const val = await ctx.ui.input("Update Timeout (ms)", String(working.timeoutMs || 10000));
      if (val !== undefined) {
        const parsed = parseInt(val.trim(), 10);
        if (!isNaN(parsed) && parsed > 0) {
          working.timeoutMs = parsed;
        }
      }
    }
  }
}

export async function handleSearxngCommand(
  args: string,
  ctx: ExtensionCommandContext,
  configPath?: string
): Promise<void> {
  const sub = (args || "").trim().toLowerCase();

  if (sub === "status") {
    await handleSearxngStatus(ctx, configPath);
  } else if (sub === "config") {
    await handleSearxngConfig(ctx, configPath);
  } else {
    ctx.ui.notify(
      "SearXNG Commands:\n  /searxng config  - Interactive settings editor\n  /searxng status  - Verify SearXNG health and latency",
      "info"
    );
  }
}
