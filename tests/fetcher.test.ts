import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchUrl } from "../src/fetcher.js";

describe("Web Fetcher", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches URL with realistic browser headers and returns body with content-type", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      url: "https://example.com/article",
      headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
      text: async () => "<html><body><p>Hello world</p></body></html>",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const result = await fetchUrl("https://example.com/article", 5000);
    expect(result.status).toBe(200);
    expect(result.contentType).toBe("text/html; charset=utf-8");
    expect(result.text).toContain("Hello world");
  });

  it("throws clear error on HTTP failure status", async () => {
    const mockResponse = {
      ok: false,
      status: 404,
      statusText: "Not Found",
      url: "https://example.com/not-found",
      text: async () => "Resource not found",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    await expect(fetchUrl("https://example.com/not-found")).rejects.toThrow(
      /HTTP 404 Not Found/
    );
  });
});
