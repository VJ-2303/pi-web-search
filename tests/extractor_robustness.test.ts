import { describe, it, expect } from "vitest";
import {
  extractMarkdownFromHtml,
  processWebResponse,
  sliceContent,
} from "../src/extractor.js";

describe("Extractor cleanup rules", () => {
  it("strips nav/header/footer/aside chrome even when Readability fails and body fallback runs", () => {
    // Short content keeps Readability below its char threshold, forcing the fallback path
    const html = `<!DOCTYPE html><html><body>
      <nav><a href="/a">Mega menu alpha</a><a href="/b">Sign in</a></nav>
      <header><div>Site header beta</div></header>
      <main><article><h1>Real Readme</h1><p>Kernel is awesome</p></article></main>
      <aside>Sidebar gamma</aside>
      <footer>GitHub footer spam delta</footer>
    </body></html>`;
    const res = extractMarkdownFromHtml(html, "https://github.com/torvalds/linux");
    expect(res.markdown).toContain("Kernel is awesome");
    expect(res.markdown).not.toContain("Mega menu alpha");
    expect(res.markdown).not.toContain("Site header beta");
    expect(res.markdown).not.toContain("Sidebar gamma");
    expect(res.markdown).not.toContain("footer spam delta");
    expect(res.markdown).not.toContain("Sign in");
  });

  it("strips nav/footer chrome nested inside the Readability-selected container", () => {
    // Long article makes Readability succeed, but it selects #content, nav and footer included
    const para =
      "<p>Paragraph body text with plenty of filler words so readability scores this node highly. </p>";
    const html = `<!DOCTYPE html><html><body>
      <div id="content">
        <nav class="pager">Pagination next previous mega links</nav>
        <article><h1>Real Post</h1>${para.repeat(8)}</article>
        <footer>Comments section spam footer</footer>
      </div>
    </body></html>`;
    const res = extractMarkdownFromHtml(html, "https://blog.example/post");
    expect(res.markdown).toContain("Paragraph body text");
    expect(res.markdown).not.toContain("Pagination");
    expect(res.markdown).not.toContain("Comments section spam");
  });

  it("unwraps same-page anchor links instead of emitting useless fragment links", () => {
    const html = `<!DOCTYPE html><html><body>
      <article>
        <h2><a href="#syntax">Syntax</a></h2>
        <p>Some paragraph text that gives readability enough to parse this article document node structure here.</p>
        <p>See <a href="#description">Description</a> above for more detail on the topic.</p>
      </article>
    </body></html>`;
    const res = extractMarkdownFromHtml(html, "https://mdn.example/array-map");
    expect(res.markdown).toContain("## Syntax");
    expect(res.markdown).not.toContain("](");
    expect(res.markdown).toContain("See Description above");
  });
  it("drops links that have no visible text (icon-only anchors)", () => {
    const html = `<!DOCTYPE html><html><body>
      <article>
        <h1>Page</h1>
        <p>Paragraph with real content that makes this body text worth keeping around for parsing.</p>
        <a href="https://github.com/"><img alt="" src="icon.png"></a>
        <a href="https://example.com/empty"></a>
      </article>
    </body></html>`;
    const res = extractMarkdownFromHtml(html, "https://example.com/page");
    expect(res.markdown).not.toContain("[](");
    expect(res.markdown).not.toContain("icon.png");
    expect(res.markdown).toContain("Paragraph with real content");
  });

  it("preserves language annotation on fenced code blocks from pre and code classes", () => {
    const html = `<!DOCTYPE html><html><body>
      <article>
        <h1>Fences</h1>
        <p>Intro paragraph with enough words for the readability parser to pick up this article node body content.</p>
        <pre><code class="language-python">print("hi")</code></pre>
        <pre class="language-bash"><code>ls -la</code></pre>
      </article>
    </body></html>`;
    const res = extractMarkdownFromHtml(html, "https://example.com/code");
    expect(res.markdown).toContain("```python");
    expect(res.markdown).toContain("```bash");
  });

  it("preserves code language on the Readability path where class attributes are stripped", () => {
    // Long article forces the Readability success path, whose serializer drops class attrs
    const para = "<p>Paragraph body text with plenty of filler words so readability scores this node highly. </p>";
    const html = `<!DOCTYPE html><html><body>
      <article><h1>Long</h1>${para.repeat(4)}<pre class="language-rust"><code>fn main() {}</code></pre>${para.repeat(4)}</article>
    </body></html>`;
    const res = extractMarkdownFromHtml(html, "https://example.com/rust");
    expect(res.markdown).toContain("Paragraph body text");
    expect(res.markdown).toContain("```rust");
  });

  it("absorbs orphan language-label lines into the following bare code fence", () => {
    // MDN emits <span class="language-name">js</span> above examples; Readability strips
    // the class, leaving a bare 'js' paragraph line before the fence
    const html = `<!DOCTYPE html><html><body>
      <article><h1>Orphan</h1><p>Intro paragraph with enough words for readability to accept this as the main content of the document body.</p>
      <p>js</p><pre><code>let a = 1;</code></pre>
      <p>Done with enough trailing prose words to keep the parser comfortable here.</p></article>
    </body></html>`;
    const res = extractMarkdownFromHtml(html, "https://example.com/mdn-ish");
    expect(res.markdown).toContain("```js\nlet a = 1;");
    expect(res.markdown).not.toMatch(/^js$/m);

    // Label line before an already-annotated fence: fence keeps its own language
    const html2 = html.replace("<pre><code>let a = 1;</code></pre>", '<pre class="language-ts"><code>let a = 1;</code></pre>');
    const res2 = extractMarkdownFromHtml(html2, "https://example.com/mdn-ish");
    expect(res2.markdown).toContain("```ts\nlet a = 1;");
    expect(res2.markdown).not.toMatch(/^js$/m);
  });

  it("normalizes turndown list padding and trailing whitespace", () => {
    const html = `<!DOCTYPE html><html><body>
      <article>
        <h1>Lists</h1>
        <p>Intro paragraph with enough words for readability to accept this document as the main article content body.</p>
        <ul><li>alpha item</li><li>beta item</li></ul>
      </article>
    </body></html>`;
    const res = extractMarkdownFromHtml(html, "https://example.com/lists");
    expect(res.markdown).toContain("- alpha item");
    expect(res.markdown).not.toMatch(/-   /);
    expect(res.markdown).not.toMatch(/ +$/m);
  });
});

describe("Extractor Robustness & Edge Cases", () => {
  it("emits frontmatter with url/title/fetched on the html path at offset 0", () => {
    const html = `<!DOCTYPE html><html><head>
      <title>Meta Post</title>
      <meta property="article:published_time" content="2025-01-02T03:04:05Z">
      <meta name="author" content="Ada Lovelace">
      <meta property="og:description" content="A short summary of the post.">
    </head><body>
      <article><h1>Meta Post</h1><p>Body text of the meta post with enough words for extraction to succeed properly here.</p></article>
    </body></html>`;
    const res = processWebResponse(html, "text/html", "https://blog.example/meta");
    expect(res.fullContent.startsWith("---\n")).toBe(true);
    expect(res.fullContent).toContain("url: https://blog.example/meta");
    expect(res.fullContent).toContain("title: Meta Post");
    expect(res.fullContent).toContain("published: 2025-01-02T03:04:05Z");
    expect(res.fullContent).toContain("author: Ada Lovelace");
    expect(res.fullContent).toContain("description: A short summary of the post.");
    expect(res.content).toContain("Body text of the meta post");
  });

  it("omits empty frontmatter keys and skips frontmatter on later slices", () => {
    const html = `<!DOCTYPE html><html><body>
      <article><h1>No Meta</h1><p>${"Filler words for extraction threshold. ".repeat(15)}</p></article>
    </body></html>`;
    const res = processWebResponse(html, "text/html", "https://example.com/plain-post");
    const frontmatter = res.fullContent.slice(0, res.fullContent.indexOf("\n---", 4) + 4);
    expect(frontmatter).not.toContain("author:");
    expect(frontmatter).not.toContain("published:");
    // Offset slice must not re-emit the header
    const res2 = processWebResponse(html, "text/html", "https://example.com/plain-post", 50);
    expect(res2.content.startsWith("---")).toBe(false);
  });

  it("normalizes CRLF, tabs, and ANSI escapes in plain text passthrough", () => {
    const raw = "line one\r\n\x1b[31mred\x1b[0m\tindented\u0000tail";
    const res = processWebResponse(raw, "text/plain", "https://example.com/f.txt");
    expect(res.content).toBe("line one\nred indentedtail");
  });

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
    // Same-page anchors are unwrapped to plain text, not kept as dead fragment links
    expect(res.markdown).not.toContain("#top");
    expect(res.markdown).toContain("Anchor");
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

  it("keeps article content past the 200KB parse cap when junk markup is pre-stripped", () => {
    // 300KB of <script> junk would previously push the cap past the article tail
    const junk = "<script>var x='" + "A".repeat(200) + "';</script>";
    const html =
      "<html><head><title>Junk Page</title></head><body>" +
      junk.repeat(1500) +
      "<article><h1>Tail Article</h1><p>This text sits beyond the raw byte cap and must survive.</p></article></body></html>";
    expect(html.length).toBeGreaterThan(200_000);
    const res = extractMarkdownFromHtml(html, "https://example.com/heavy");
    expect(res.markdown).toContain("This text sits beyond the raw byte cap");
    expect(res.markdown).not.toContain("var x=");
  });

  it("guards against giant raw HTML payloads (>200KB)", () => {
    const giantHtml = "<p>word </p>".repeat(25000); // ~300KB (exceeds 200KB cap)
    const res = extractMarkdownFromHtml(giantHtml);
    expect(res.markdown.length).toBeGreaterThan(0);
  });
});
