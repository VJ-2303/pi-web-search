import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchSearxng, formatSearchResults } from "../src/searxng.js";
import type { SearxngConfig } from "../src/config.js";

describe("SearXNG Client", () => {
  const mockConfig: SearxngConfig = {
    endpoint: "http://searxng.local",
    categories: "general",
    timeoutMs: 5000,
  };

  const sampleApiResponse = {
    query: "typescript coding agent",
    results: [
      {
        title: "TypeScript Official",
        url: "https://www.typescriptlang.org",
        content: "TypeScript is JavaScript with syntax for types.",
        publishedDate: "2026-01-01",
      },
      {
        title: "Pi Agent Repo",
        url: "https://github.com/earendil-works/pi",
        content: "A terminal-based coding agent.",
      },
    ],
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends correct query parameters and headers to SearXNG", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => sampleApiResponse,
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await searchSearxng(mockConfig, {
      query: "typescript coding agent",
      num_results: 1,
      categories: "it",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0].toString();
    expect(calledUrl).toContain("http://searxng.local/search?");
    expect(calledUrl).toContain("q=typescript+coding+agent");
    expect(calledUrl).toContain("format=json");
    expect(calledUrl).toContain("categories=it");
    expect(calledUrl).not.toContain("time_range=");

    expect(res.results.length).toBe(1);
    expect(res.results[0].title).toBe("TypeScript Official");
    expect(res.markdown).toContain("### Search Results for \"typescript coding agent\"");
    expect(res.markdown).toContain("[TypeScript Official](https://www.typescriptlang.org)");
  });

  it("defaults to 4 results when num_results is not provided", async () => {
    const fiveResults = Array.from({ length: 5 }, (_, i) => ({
      title: `Result ${i + 1}`,
      url: `https://example.com/${i + 1}`,
      content: `Content ${i + 1}`,
    }));

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ query: "test", results: fiveResults }),
      })
    );

    const res = await searchSearxng(mockConfig, { query: "test" });
    expect(res.results.length).toBe(4);
  });

  it("handles 403 error with specific guidance on enabling json format", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: async () => "format json is not enabled",
      })
    );

    await expect(
      searchSearxng(mockConfig, { query: "test" })
    ).rejects.toThrow(/SearXNG instance disabled JSON format/);
  });

  it("formats empty results cleanly", () => {
    const md = formatSearchResults("unknown query", []);
    expect(md).toBe('No results found for "unknown query".');
  });

  it("sanitizes HTML tags and decodes entities in snippets", () => {
    const dirtyResults = [
      {
        title: "Test &amp; Demo",
        url: "https://example.com",
        content: "Learn <b>TypeScript</b> &quot;coding&quot; with &lt;agents&gt; &amp; tools.",
      },
    ];
    const md = formatSearchResults("test", dirtyResults);
    expect(md).toContain('Learn TypeScript "coding" with <agents> & tools.');
    expect(md).not.toContain("<b>");
    expect(md).not.toContain("&quot;");
    expect(md).not.toContain("&amp;");
  });
});
