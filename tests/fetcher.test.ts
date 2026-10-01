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

  it("decodes body using charset declared in Content-Type header", async () => {
    // "caf\u00e9" encoded in ISO-8859-1: 0x63 0x61 0x66 0xe9
    const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: "https://example.com/latin1",
        headers: new Headers({ "content-type": "text/html; charset=iso-8859-1" }),
        body: new ReadableStream({
          start(c: any) {
            c.enqueue(latin1);
            c.close();
          },
        }),
      })
    );

    const result = await fetchUrl("https://example.com/latin1");
    expect(result.text).toBe("caf\u00e9");
  });

  it("falls back to utf-8 when no charset is declared", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("plain utf8 caf\u00e9"));
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: "https://example.com/utf8",
        headers: new Headers({ "content-type": "text/html" }),
        body: stream,
      })
    );

    const result = await fetchUrl("https://example.com/utf8");
    expect(result.text).toBe("plain utf8 caf\u00e9");
  });

  it("falls back to meta charset when header omits charset", async () => {
    // ISO-8859-1 bytes for <meta charset=windows-1252> plus "caf\u00e9"
    const bytes = new TextEncoder().encode(
      '<html><head><meta charset="windows-1252"></head><body>'
    );
    const latin = new Uint8Array([...bytes, 0x63, 0x61, 0x66, 0xe9, 0x3c]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: "https://example.com/meta",
        headers: new Headers({ "content-type": "text/html" }),
        body: new ReadableStream({
          start(c: any) {
            c.enqueue(latin);
            c.close();
          },
        }),
      })
    );

    const result = await fetchUrl("https://example.com/meta");
    expect(result.text).toContain("caf\u00e9");
  });

  it("includes response body excerpt in HTTP error messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        url: "https://example.com/blocked",
        headers: new Headers({ "content-type": "text/html" }),
        text: async () => "<html><body>Access denied by bot protection policy</body></html>",
      })
    );

    await expect(fetchUrl("https://example.com/blocked")).rejects.toThrow(
      /Access denied by bot protection/
    );
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
