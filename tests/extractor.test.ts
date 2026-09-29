import { describe, it, expect } from "vitest";
import { extractMarkdownFromHtml, processWebResponse, sliceContent } from "../src/extractor.js";

describe("Content Extractor", () => {
  const sampleHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Guide to Pi Extensions</title>
      </head>
      <body>
        <header>
          <nav>
            <a href="/">Home</a>
            <a href="/login">Sign In</a>
          </nav>
        </header>
        <aside class="advertisement">
          <p>Buy our sponsored product now!</p>
        </aside>
        <main>
          <article>
            <h1>Understanding Pi Extensions</h1>
            <p>Extensions are TypeScript modules that add tools and behavior to Pi.</p>
            <p>They allow coding agents to perform actions such as web search and file edits.</p>
          </article>
        </main>
        <footer>
          <p>Copyright 2026. All rights reserved.</p>
        </footer>
      </body>
    </html>
  `;

  it("extracts core article and converts to markdown while stripping nav and ads", () => {
    const result = extractMarkdownFromHtml(sampleHtml, "https://pi.dev/docs");
    expect(result.title).toContain("Guide to Pi Extensions");
    expect(result.markdown).toContain("Understanding Pi Extensions");
    expect(result.markdown).toContain("Extensions are TypeScript modules");
    expect(result.markdown).not.toContain("Sign In");
    expect(result.markdown).not.toContain("Buy our sponsored product");
    expect(result.markdown).not.toContain("Copyright 2026");
  });

  it("handles plain text and json directly", () => {
    const textRes = processWebResponse("Hello raw text", "text/plain", "https://example.com/test.txt");
    expect(textRes.content).toBe("Hello raw text");

    const jsonRes = processWebResponse('{"status":"ok"}', "application/json", "https://example.com/api");
    expect(jsonRes.content).toContain('```json\n{\n  "status": "ok"\n}\n```');
  });

  it("identifies binary content types and returns descriptive notice", () => {
    const res = processWebResponse("", "application/pdf", "https://example.com/doc.pdf");
    expect(res.content).toContain("Binary content detected (application/pdf)");
  });

  it("slices content according to offset and maxLength with pagination notice", () => {
    const longContent = "A".repeat(1000);
    const sliced = sliceContent(longContent, 0, 400);

    expect(sliced.truncated).toBe(true);
    expect(sliced.text).toContain("A".repeat(400));
    expect(sliced.text).toContain("Note: Content truncated. Showing characters 0 to 400 of 1000");
    expect(sliced.text).toContain("offset=400");
  });

  it("does not truncate when content fits inside maxLength", () => {
    const shortContent = "Short text";
    const sliced = sliceContent(shortContent, 0, 500);

    expect(sliced.truncated).toBe(false);
    expect(sliced.text).toBe("Short text");
  });

  it("strips massive data-URI image payloads while preserving alt text", () => {
    const htmlWithDataUri = `
      <article>
        <h1>Article with Images</h1>
        <p>Before image</p>
        <img alt="Diagram" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" />
        <img alt="Real Logo" src="https://example.com/logo.png" />
        <p>After image</p>
      </article>
    `;
    const res = extractMarkdownFromHtml(htmlWithDataUri);
    expect(res.markdown).toContain("[Image: Diagram]");
    expect(res.markdown).not.toContain("data:image/png;base64");
    expect(res.markdown).toContain("![Real Logo](https://example.com/logo.png)");
  });

  it("collapses excessive consecutive blank lines", () => {
    const htmlWithGaps = `
      <article>
        <h1>Spaced Article</h1>
        <div><br/><br/><br/></div>
        <p>Paragraph 1</p>
        <div><br/><br/><br/></div>
        <p>Paragraph 2</p>
      </article>
    `;
    const res = extractMarkdownFromHtml(htmlWithGaps);
    expect(res.markdown).not.toMatch(/\n{3,}/);
  });

  it("handles offset exceeding content length cleanly", () => {
    const res = sliceContent("Short content", 50, 100);
    expect(res.truncated).toBe(false);
    expect(res.text).toContain("exceeds total content length");
  });

  it("normalizes negative offset to 0", () => {
    const res = sliceContent("Hello world", -10, 5);
    expect(res.text).toContain("Hello");
  });

  it("converts HTML tables and code blocks into standard markdown", () => {
    const html = `
      <article>
        <h1>Code & Table</h1>
        <pre><code class="language-typescript">const x: number = 42;</code></pre>
        <table>
          <thead>
            <tr><th>Header 1</th><th>Header 2</th></tr>
          </thead>
          <tbody>
            <tr><td>Cell 1</td><td>Cell 2</td></tr>
          </tbody>
        </table>
      </article>
    `;
    const res = extractMarkdownFromHtml(html);
    expect(res.markdown).toContain("```");
    expect(res.markdown).toContain("const x: number = 42;");
    expect(res.markdown).toContain("Cell 1");
    expect(res.markdown).toContain("Header 1");
  });

  it("handles case-insensitive and parameterized Content-Type headers", () => {
    const jsonRes = processWebResponse('{"hello":"world"}', "APPLICATION/JSON; charset=utf-8");
    expect(jsonRes.content).toContain('```json\n{\n  "hello": "world"\n}\n```');

    const htmlRes = processWebResponse("<p>Hello</p>", "TEXT/HTML; charset=iso-8859-1");
    expect(htmlRes.content).toContain("Hello");
  });

  it("falls back to raw string when application/json has invalid JSON syntax", () => {
    const res = processWebResponse("{ broken json", "application/json");
    expect(res.content).toBe("{ broken json");
  });
});
