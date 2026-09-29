import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import registerExtension from "../src/index.js";

describe("Pi Extension Registration", () => {
  let registeredTools: Map<string, any>;
  let mockPi: any;

  beforeEach(() => {
    registeredTools = new Map();
    mockPi = {
      registerTool: vi.fn((toolDef: any) => {
        registeredTools.set(toolDef.name, toolDef);
      }),
    };
  });

  it("registers both web_search and web_fetch tools with correct annotations", () => {
    registerExtension(mockPi);

    expect(mockPi.registerTool).toHaveBeenCalledTimes(2);
    expect(registeredTools.has("web_search")).toBe(true);
    expect(registeredTools.has("web_fetch")).toBe(true);

    const searchTool = registeredTools.get("web_search");
    expect(searchTool.annotations?.readOnlyHint).toBe(true);
    expect(searchTool.annotations?.openWorldHint).toBe(true);
    expect(searchTool.parameters.properties.time_range).toBeUndefined();
    expect(searchTool.parameters.properties.num_results.default).toBe(4);

    const fetchTool = registeredTools.get("web_fetch");
    expect(fetchTool.annotations?.readOnlyHint).toBe(true);
    expect(fetchTool.annotations?.openWorldHint).toBe(true);
  });

  it("executes web_search tool and returns formatted content", async () => {
    registerExtension(mockPi);
    const searchTool = registeredTools.get("web_search");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          query: "pi agent",
          results: [{ title: "Pi", url: "https://pi.dev", content: "Agent" }],
        }),
      })
    );

    // Mock loadConfig to use memory
    vi.mock("../src/config.js", () => ({
      loadConfig: () => ({ endpoint: "http://localhost:8080", timeoutMs: 5000 }),
    }));

    const result = await searchTool.execute("call-1", { query: "pi agent" });
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("[Pi](https://pi.dev)");
    expect(result.details.resultCount).toBe(1);

    vi.unstubAllGlobals();
  });

  it("executes web_fetch, caches full content to disk, and includes cache notice", async () => {
    registerExtension(mockPi);
    const fetchTool = registeredTools.get("web_fetch");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: "https://example.com/cached-article",
        headers: new Headers({ "content-type": "text/html" }),
        text: async () => "<article><h1>Cached Title</h1><p>Full body text</p></article>",
      })
    );

    const result = await fetchTool.execute("call-2", { url: "https://example.com/cached-article" });
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("Cached full content");
    expect(result.content[0].text).toContain("Cached Title");
    expect(result.details.cachedFilePath).toBeDefined();
    expect(result.details.cachedFilePath).toContain("example-com-cached-article");

    vi.unstubAllGlobals();
  });

  it("propagates errors from searchSearxng to caller in web_search", async () => {
    registerExtension(mockPi);
    const searchTool = registeredTools.get("web_search");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Connection refused"))
    );

    await expect(searchTool.execute("call-3", { query: "fail" })).rejects.toThrow(
      "Connection refused"
    );

    vi.unstubAllGlobals();
  });

  it("propagates errors from fetchUrl to caller in web_fetch", async () => {
    registerExtension(mockPi);
    const fetchTool = registeredTools.get("web_fetch");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        url: "https://example.com/missing",
        text: async () => "Not found",
      })
    );

    await expect(fetchTool.execute("call-4", { url: "https://example.com/missing" })).rejects.toThrow(
      "HTTP 404 Not Found"
    );

    vi.unstubAllGlobals();
  });
});
