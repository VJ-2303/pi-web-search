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
});
