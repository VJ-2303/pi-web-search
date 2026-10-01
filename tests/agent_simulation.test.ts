import { describe, it, expect } from "vitest";
import registerExtension, { type ExtensionAPI } from "../src/index.js";
import * as fs from "node:fs";

describe("Agent Simulation: Using index.ts exactly as Pi agent does", () => {
  const registeredTools = new Map<string, any>();
  const registeredCommands = new Map<string, any>();

  const mockPi: ExtensionAPI = {
    registerTool: (tool) => {
      registeredTools.set(tool.name, tool);
    },
    registerCommand: (name, cmd) => {
      registeredCommands.set(name, cmd);
    },
  };

  it("simulates full agent lifecycle: discovery, search, fetch, pagination, and status", async () => {
    // Step 1: Agent boots and registers extension
    registerExtension(mockPi);

    expect(registeredTools.has("web_search")).toBe(true);
    expect(registeredTools.has("web_fetch")).toBe(true);
    expect(registeredCommands.has("searxng")).toBe(true);

    const webSearch = registeredTools.get("web_search");
    const webFetch = registeredTools.get("web_fetch");
    const searxngCommand = registeredCommands.get("searxng");

    console.log("\n[AGENT SIMULATION] Step 1: Extension Registered");
    console.log("Registered tools:", Array.from(registeredTools.keys()));
    console.log("Registered commands:", Array.from(registeredCommands.keys()));

    // Step 2: Agent calls web_search
    console.log("\n[AGENT SIMULATION] Step 2: Agent calls web_search for 'Linux'");
    const searchResult = await webSearch.execute("call_search_1", {
      query: "Linux",
      num_results: 3,
    });

    expect(searchResult).toBeDefined();
    expect(searchResult.content).toBeInstanceOf(Array);
    expect(searchResult.content[0].type).toBe("text");
    expect(typeof searchResult.content[0].text).toBe("string");
    expect(searchResult.details).toBeDefined();
    expect(searchResult.details.resultCount).toBeGreaterThan(0);

    console.log("Agent received search markdown:\n---");
    console.log(searchResult.content[0].text);
    console.log("---");
    console.log("Agent received search details:", {
      query: searchResult.details.query,
      resultCount: searchResult.details.resultCount,
      firstUrl: searchResult.details.results[0]?.url,
    });

    const targetUrl = searchResult.details.results[0].url;
    expect(targetUrl).toBeDefined();

    // Step 3: Agent calls web_fetch on the top URL with small max_length to trigger pagination
    console.log(`\n[AGENT SIMULATION] Step 3: Agent calls web_fetch on '${targetUrl}' (max_length=600)`);
    const fetchChunk1 = await webFetch.execute("call_fetch_1", {
      url: targetUrl,
      offset: 0,
      max_length: 600,
    });

    expect(fetchChunk1.content).toBeInstanceOf(Array);
    expect(fetchChunk1.content[0].type).toBe("text");
    expect(fetchChunk1.content[0].text).toContain("Cached full content");
    expect(fetchChunk1.content[0].text).toContain("Note: Content truncated");
    expect(fetchChunk1.details.truncated).toBe(true);
    expect(fetchChunk1.details.cachedFilePath).toBeDefined();
    expect(fs.existsSync(fetchChunk1.details.cachedFilePath)).toBe(true);

    console.log("Agent received fetch chunk 1:\n---");
    console.log(fetchChunk1.content[0].text);
    console.log("---");
    console.log("Disk cache confirmed at:", fetchChunk1.details.cachedFilePath);

    // Step 4: Agent follows truncation note and calls web_fetch with offset=600
    console.log("\n[AGENT SIMULATION] Step 4: Agent calls web_fetch for next page (offset=600, max_length=600)");
    const fetchChunk2 = await webFetch.execute("call_fetch_2", {
      url: targetUrl,
      offset: 600,
      max_length: 600,
    });

    expect(fetchChunk2.content[0].text).toContain("Cached full content");
    expect(fetchChunk2.details.truncated).toBe(true);

    console.log("Agent received fetch chunk 2:\n---");
    console.log(fetchChunk2.content[0].text);
    console.log("---");

    // Step 5: User triggers /searxng status slash command
    console.log("\n[AGENT SIMULATION] Step 5: User runs /searxng status");
    let notifyMsg = "";
    let notifyType = "";
    let confirmTitle = "";
    let confirmMsg = "";

    const mockCtx = {
      ui: {
        notify: (msg: string, type: string) => {
          notifyMsg = msg;
          notifyType = type;
        },
        confirm: async (title: string, msg: string) => {
          confirmTitle = title;
          confirmMsg = msg;
          return true;
        },
      },
    };

    await searxngCommand.handler("status", mockCtx);

    expect(notifyType).toBe("info");
    expect(notifyMsg).toContain("healthy");
    expect(confirmTitle).toBe("SearXNG Health Status");
    expect(confirmMsg).toContain("Healthy (HTTP 200)");

    console.log("User received status notify:", notifyMsg);
    console.log("User received status modal:\n---");
    console.log(confirmMsg);
    console.log("---\n[AGENT SIMULATION] All Agent Interactions Succeeded.");
  });
});
