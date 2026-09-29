import { describe, it, expect } from "vitest";
import {
  extractMarkdownFromHtml,
  processWebResponse,
  sliceContent,
} from "../src/extractor.js";

describe("Extractor Robustness & Edge Cases", () => {
  it("handles completely empty HTML and whitespace gracefully", () => {
    const res1 = extractMarkdownFromHtml("", "https://example.com");
    expect(res1.markdown).toBe("");

    const res2 = processWebResponse("", "text/html", "https://example.com");
    expect(res2.content).toBe("*Empty content returned from web page.*");
  });

  it("resolves relative links to absolute URLs based on base URL", () => {
    const html = `
      <article>
        <h1>Links</h1>
        <p><a href="/about">About Us</a></p>
        <p><a href="docs/guide.html">Guide</a></p>
        <p><a href="https://other.com/ext">External</a></p>
        <p><a href="#top">Anchor</a></p>
      </article>
    `;
    const res = extractMarkdownFromHtml(html, "https://example.com/sub/index.html");
    expect(res.markdown).toContain("[About Us](https://example.com/about)");
    expect(res.markdown).toContain("[Guide](https://example.com/sub/docs/guide.html)");
    expect(res.markdown).toContain("[External](https://other.com/ext)");
    expect(res.markdown).toContain("[Anchor](#top)");
  });

  it("resolves relative image URLs to absolute URLs and removes javascript links", () => {
    const html = `
      <article>
        <h1>Media</h1>
        <img alt="Logo" src="/assets/logo.png" />
        <a href="javascript:alert(1)">Click Me</a>
      </article>
    `;
    const res = extractMarkdownFromHtml(html, "https://example.com/page");
    expect(res.markdown).toContain("![Logo](https://example.com/assets/logo.png)");
    expect(res.markdown).not.toContain("javascript:");
    expect(res.markdown).toContain("Click Me");
  });

  it("handles NaN and non-positive numbers in sliceContent safely", () => {
    const content = "Hello world";
    const res1 = sliceContent(content, NaN, 5);
    expect(res1.text).toContain("Hello");
    expect(res1.truncated).toBe(true);

    const res2 = sliceContent(content, 0, -100);
    expect(res2.text).toContain("H"); // clamped to minimum 1 char
    expect(res2.truncated).toBe(true);
  });

  it("guards against giant raw HTML payloads (>200KB)", () => {
    const giantHtml = "<p>word </p>".repeat(25000); // ~300KB (exceeds 200KB cap)
    const res = extractMarkdownFromHtml(giantHtml);
    expect(res.markdown.length).toBeGreaterThan(0);
  });
});
