import { describe, it, expect } from "vitest";
import registerExtension from "../src/index.js";
import { loadConfig } from "../src/config.js";
import { checkSearxngHealth, searchSearxng } from "../src/searxng.js";
import * as fs from "node:fs";

describe("Live SearXNG Integration", () => {
  it("verifies health check against live SearXNG instance", async () => {
    const config = loadConfig();
    const health = await checkSearxngHealth(config);

    expect(health.healthy).toBe(true);
    expect(health.status).toBe(200);
    expect(health.jsonEnabled).toBe(true);
    expect(health.latencyMs).toBeGreaterThan(0);
  });

  it("performs real search query against live SearXNG", async () => {
    const config = loadConfig();
    const result = await searchSearxng(config, { query: "Linux", num_results: 3 });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].title.length).toBeGreaterThan(0);
    expect(result.results[0].url.startsWith("http")).toBe(true);
    expect(result.markdown).toContain("Search Results for \"Linux\"");
  });

  it("executes tools registered with ExtensionAPI end-to-end", async () => {
    const tools = new Map<string, any>();
    const commands = new Map<string, any>();

    const mockPi = {
      registerTool(tool: any) {
        tools.set(tool.name, tool);
      },
      registerCommand(name: string, cmd: any) {
        commands.set(name, cmd);
      },
    };

    registerExtension(mockPi);

    // 1. web_search execution
    const searchTool = tools.get("web_search");
    const searchRes = await searchTool.execute("call-1", { query: "python", num_results: 2 });
    expect(searchRes.content[0].type).toBe("text");
    expect(searchRes.details.resultCount).toBeGreaterThan(0);

    const firstUrl = searchRes.details.results[0].url;

    // 2. web_fetch execution
    const fetchTool = tools.get("web_fetch");
    const fetchRes = await fetchTool.execute("call-2", { url: firstUrl, max_length: 1000 });
    expect(fetchRes.content[0].text).toContain("Cached full content");
    expect(fetchRes.details.cachedFilePath).toBeDefined();
    expect(fs.existsSync(fetchRes.details.cachedFilePath)).toBe(true);

    // 3. /searxng slash command execution
    const searxngCmd = commands.get("searxng");
    let notificationText = "";
    const mockCtx = {
      ui: {
        notify: (msg: string) => {
          notificationText = msg;
        },
        confirm: async () => true,
      },
    };
    await searxngCmd.handler("status", mockCtx);
    expect(notificationText).toContain("healthy");
  });
});
