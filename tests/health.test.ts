import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkSearxngHealth } from "../src/searxng.js";

describe("SearXNG Health Check", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports healthy when SearXNG responds with 200 and valid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ results: [] }),
      })
    );

    const result = await checkSearxngHealth({ endpoint: "http://localhost:8080" });
    expect(result.healthy).toBe(true);
    expect(result.status).toBe(200);
    expect(result.jsonEnabled).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.message).toContain("healthy");
  });

  it("reports unhealthy when network connection fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
    );

    const result = await checkSearxngHealth({ endpoint: "http://localhost:8080" });
    expect(result.healthy).toBe(false);
    expect(result.status).toBe(0);
    expect(result.message).toContain("ECONNREFUSED");
  });

  it("reports unhealthy when SearXNG returns HTML instead of JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        json: async () => {
          throw new Error("Unexpected token < in JSON");
        },
      })
    );

    const result = await checkSearxngHealth({ endpoint: "http://localhost:8080" });
    expect(result.healthy).toBe(false);
    expect(result.jsonEnabled).toBe(false);
    expect(result.message).toContain("JSON format disabled");
  });

  it("requests /search under a path-mounted endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ results: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkSearxngHealth({ endpoint: "https://myhost.com/searxng" });
    expect(result.healthy).toBe(true);
    const requested = new URL(fetchMock.mock.calls[0][0] as string);
    expect(requested.pathname).toBe("/searxng/search");
  });

  it("reports unhealthy when server returns 500 error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers({ "content-type": "text/plain" }),
        text: async () => "Internal Server Error",
        json: async () => ({}),
      })
    );

    const result = await checkSearxngHealth({ endpoint: "http://localhost:8080" });
    expect(result.healthy).toBe(false);
    expect(result.status).toBe(500);
    expect(result.message).toContain("HTTP 500");
  });
});
