import { describe, it, expect, vi } from "vitest";

const { saveToCacheMock } = vi.hoisted(() => ({ saveToCacheMock: vi.fn() }));

vi.mock("../src/cache.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cache.js")>()),
  saveToCache: saveToCacheMock,
}));

vi.mock("../src/config.js", () => ({
  loadConfig: () => ({ endpoint: "http://localhost:8080", timeoutMs: 5000 }),
  ensureConfigFile: () => {},
}));

import registerExtension from "../src/index.js";

describe("web_fetch resilience to cache failures", () => {
  const setup = () => {
    const tools = new Map<string, any>();
    registerExtension({
      registerTool: (t: any) => tools.set(t.name, t),
    } as any);
    return tools.get("web_fetch");
  };

  it("returns fetched content without cache notice when saveToCache throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: "https://example.com/article",
        headers: new Headers({ "content-type": "text/html" }),
        text: async () => "<article><h1>Title</h1><p>Body text</p></article>",
      })
    );
    saveToCacheMock.mockImplementation(() => {
      throw new Error("EROFS: read-only file system");
    });

    const result = await setup().execute("call-1", { url: "https://example.com/article" });

    expect(result.content[0].text).toContain("Body text");
    expect(result.content[0].text).not.toContain("Cached full content");
    expect(result.details.cachedFilePath).toBeUndefined();

    vi.unstubAllGlobals();
  });

  it("includes cache notice when saveToCache succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: "https://example.com/article",
        headers: new Headers({ "content-type": "text/html" }),
        text: async () => "<article><h1>Title</h1><p>Body text</p></article>",
      })
    );
    saveToCacheMock.mockReturnValue({
      filePath: "/tmp/cache/article.md",
      charCount: 42,
    });

    const result = await setup().execute("call-2", { url: "https://example.com/article" });

    expect(result.content[0].text).toContain("Cached full content");
    expect(result.details.cachedFilePath).toBe("/tmp/cache/article.md");

    vi.unstubAllGlobals();
  });
});
