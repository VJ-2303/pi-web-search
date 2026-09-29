import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { saveToCache, getCacheFilename } from "../src/cache.js";

describe("Web Cache Manager", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cache-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates clean, human-readable slug and hash for a URL", () => {
    const filename = getCacheFilename("https://pi.dev/docs/latest/extensions?ref=search");
    expect(filename).toMatch(/^pi-dev-docs-latest-extensions-[a-f0-9]{8}\.md$/);
  });

  it("saves full content to cache directory and creates parent directories if needed", () => {
    const cacheDir = path.join(tmpDir, "nested", "cache");
    const url = "https://example.com/docs/api";
    const markdown = "# API Documentation\n\nFull clean text";

    const result = saveToCache(url, markdown, cacheDir);

    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(fs.readFileSync(result.filePath, "utf-8")).toBe(markdown);
    expect(result.charCount).toBe(markdown.length);
    expect(result.filePath).toContain("example-com-docs-api");
  });

  it("handles malformed URLs gracefully by falling back to page hash", () => {
    const filename = getCacheFilename("not-a-valid-url");
    expect(filename).toMatch(/^page-[a-f0-9]{8}\.md$/);
  });

  it("handles URLs with ports, anchors, and queries", () => {
    const filename = getCacheFilename("http://localhost:3000/app/v1?user=123#overview");
    expect(filename).toContain("localhost-app-v1");
  });

  it("overwrites existing cache file when called repeatedly for the same URL", () => {
    const url = "https://example.com/live-data";
    saveToCache(url, "version 1", tmpDir);
    const updated = saveToCache(url, "version 2 (updated)", tmpDir);

    expect(fs.readFileSync(updated.filePath, "utf-8")).toBe("version 2 (updated)");
  });
});
