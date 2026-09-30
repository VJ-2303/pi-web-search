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

  it("rejects non-http protocols like file: or ftp:", async () => {
    await expect(fetchUrl("file:///etc/passwd")).rejects.toThrow(
      /Invalid URL protocol/
    );
    await expect(fetchUrl("ftp://ftp.example.com/file")).rejects.toThrow(
      /Invalid URL protocol/
    );
  });

  it("handles fetch timeout error", async () => {
    const timeoutErr = new Error("The operation was aborted due to timeout");
    timeoutErr.name = "TimeoutError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeoutErr));

    await expect(fetchUrl("https://example.com/slow", 2000)).rejects.toThrow(
      /Fetch timed out after 2000ms/
    );
  });

  it("rejects response when content-length exceeds the size cap", async () => {
    const textMock = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: "https://example.com/huge",
        headers: new Headers({
          "content-type": "text/html",
          "content-length": String(60_000_000),
        }),
        text: textMock,
      })
    );

    await expect(fetchUrl("https://example.com/huge")).rejects.toThrow(
      /too large/i
    );
    expect(textMock).not.toHaveBeenCalled();
  });

  it("rejects response when streamed body exceeds the size cap (no content-length)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: "https://example.com/chunky",
        headers: new Headers({ "content-type": "text/html" }),
        text: async () => "x".repeat(6_000_000),
      })
    );

    await expect(fetchUrl("https://example.com/chunky")).rejects.toThrow(/too large/i);
  });

  it("handles network connection failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND example.invalid"))
    );

    await expect(fetchUrl("https://example.invalid")).rejects.toThrow(
      /Failed to fetch https:\/\/example.invalid: getaddrinfo ENOTFOUND/
    );
  });
});
