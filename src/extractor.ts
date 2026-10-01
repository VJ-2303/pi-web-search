import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

const MAX_RAW_HTML_CHARS = 200_000; // 200KB raw cap to protect CPU/memory

const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  hr: "---",
  bulletListMarker: "-",
});

// Remove scripts, styles, iframes from turndown output to save tokens
turndownService.addRule("stripUnwantedTags", {
  filter: (node) => {
    const tag = node.nodeName.toLowerCase();
    return ["script", "style", "noscript", "svg", "iframe", "object", "embed"].includes(tag);
  },
  replacement: () => "",
});

// Strip data-URI image payloads while preserving alt text or external URLs
turndownService.addRule("images", {
  filter: "img",
  replacement: (_content, node) => {
    const el = node as HTMLElement;
    const alt = el.getAttribute("alt") || "";
    const src = el.getAttribute("src") || "";
    if (src.startsWith("data:")) {
      return alt ? `[Image: ${alt}]` : "";
    }
    return alt ? `![${alt}](${src})` : src ? `![](${src})` : "";
  },
});

// Replace turndown's built-in fence rule: language may live in class="language-x",
// class="brush: x" (Prism/MDN) or data-lang (survives Readability class stripping)
function languageOf(el: any): string {
  if (!el?.getAttribute) return "";
  const cls: string = el.getAttribute("class") || "";
  let m = /language-([\w+#.\-]+)/.exec(cls);
  if (!m) m = /brush:\s*([\w+#.\-]+)/.exec(cls);
  if (m) return m[1];
  return el.getAttribute("data-lang") || "";
}

turndownService.addRule("fencedCodeBlock", {
  filter: (node: any, options: any) =>
    options.codeBlockStyle === "fenced" &&
    node.nodeName === "PRE" &&
    node.firstChild &&
    node.firstChild.nodeName === "CODE",
  replacement: (_content: string, node: any, options: any) => {
    const code = node.firstChild;
    const lang = languageOf(code) || languageOf(node);
    const text: string = (code.textContent || "").replace(/\n$/, "");
    const fenceChar = (options.fence || "```").charAt(0);
    let fenceSize = 3;
    const fenceInCodeRegex = new RegExp("^" + fenceChar + "{3,}", "gm");
    let match;
    while ((match = fenceInCodeRegex.exec(text))) {
      if (match[0].length >= fenceSize) fenceSize = match[0].length + 1;
    }
    const fence = fenceChar.repeat(fenceSize);
    return "\n\n" + fence + lang + "\n" + text + "\n" + fence + "\n\n";
  },
});

export interface ExtractionResult {
  title?: string;
  markdown: string;
  meta?: PageMeta;
}

export interface PageMeta {
  published?: string;
  author?: string;
  description?: string;
}

function metaContent(document: any, attr: string, value: string): string | undefined {
  const el = document.querySelector(`meta[${attr}="${value}"]`);
  const raw = el?.getAttribute?.("content")?.replace(/\s+/g, " ").trim();
  return raw ? raw : undefined;
}

function extractPageMeta(document: any): PageMeta {
  const meta: PageMeta = {};
  const published =
    metaContent(document, "property", "article:published_time") ||
    metaContent(document, "name", "date") ||
    metaContent(document, "itemprop", "datePublished");
  if (published) meta.published = published;
  const author = metaContent(document, "name", "author") || metaContent(document, "property", "article:author");
  if (author) meta.author = author;
  const description =
    metaContent(document, "property", "og:description") || metaContent(document, "name", "description");
  if (description) meta.description = description;
  return meta;
}

// YAML-ish header so an LLM always knows source, title and vintage of cached text
export function buildFrontmatter(fields: Record<string, string | undefined>): string {
  const lines = Object.entries(fields)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`);
  if (lines.length === 0) return "";
  return `---\n${lines.join("\n")}\n---\n\n`;
}

// CRLF/CR -> LF, tabs -> single space, drop ANSI escapes and NULs from plain-text bodies
function normalizePlainText(raw: string): string {
  return raw
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x00/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ");
}

// Chrome/boilerplate containers that are never the article a model wants to read
const CHROME_SELECTORS = [
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "[role=navigation]",
  "[role=banner]",
  "[role=contentinfo]",
  "[role=search]",
  "#sidebar",
  ".sidebar",
  ".breadcrumb",
  ".breadcrumbs",
];

// Content candidates for the body-fallback path, densest match wins
const CONTENT_CANDIDATE_SELECTORS = [
  "article",
  "main",
  "[itemprop=articleBody]",
  "#readme",
  ".markdown-body",
  "[class*=content]",
  "[id*=content]",
];

function stripChromeNodes(root: { querySelectorAll(sel: string): any[] }): void {
  for (const sel of CHROME_SELECTORS) {
    for (const node of root.querySelectorAll(sel)) {
      // A header living inside an article is the article's own byline/date block
      if (node.closest?.("article, main, [itemprop=articleBody]")) continue;
      node.remove();
    }
  }
}

function textDensity(node: any): number {
  const text: string = node.textContent || "";
  return text.replace(/\s+/g, " ").trim().length;
}

function pickContentRoot(document: any): string {
  let best = 0;
  let bestHtml = "";
  for (const sel of CONTENT_CANDIDATE_SELECTORS) {
    for (const node of document.querySelectorAll(sel)) {
      const density = textDensity(node);
      if (density > best) {
        best = density;
        bestHtml = node.innerHTML || "";
      }
    }
  }
  if (best >= MIN_CANDIDATE_CHARS && bestHtml) return bestHtml;
  return document.body?.innerHTML || document.toString();
}

const MIN_CANDIDATE_CHARS = 200;

// Turndown reads language-* only off <code>; Readability strips class attributes but
// keeps data-*, so copy the language onto data-lang before serialization happens
function annotateCodeLanguage(document: any): void {
  for (const pre of document.querySelectorAll("pre")) {
    const code = pre.querySelector?.("code");
    const lang = languageOf(pre) || (code ? languageOf(code) : "");
    if (!lang) continue;
    pre.setAttribute("data-lang", lang);
    if (code) code.setAttribute("data-lang", lang);
  }
}

// Single-word label lines (MDN's <span class="language-name">js</span>) that end up
// orphaned above a fence with no info string; absorbed only for known language tokens
const LANGUAGE_TOKENS = new Set([
  "js", "javascript", "ts", "typescript", "jsx", "tsx", "json", "html", "css", "scss",
  "py", "python", "bash", "sh", "shell", "zsh", "c", "cpp", "csharp", "go", "rust",
  "java", "kotlin", "swift", "php", "ruby", "sql", "md", "markdown", "yaml", "toml",
  "xml", "diff", "text", "plain", "rs", "cs",
]);

function absorbLanguageLabels(md: string): string {
  return md.replace(
    /^([A-Za-z+.#-]{1,15})[ \t]*\n(?:[ \t]*\n)*(```)([A-Za-z+.#-]{0,15})$/gm,
    (match, label: string, fence: string, existing: string) => {
      if (!LANGUAGE_TOKENS.has(label.toLowerCase())) return match;
      const lang = existing || label.toLowerCase();
      return `${fence}${lang}`;
    }
  );
}

function cleanMarkdownWhitespace(md: string): string {
  return absorbLanguageLabels(
    md
      .replace(/[ \t]+$/gm, "") // trailing whitespace turndown leaves on blank/list lines
      .replace(/^(\s*)[-*+]\s+/gm, "$1- ") // '-   item' (turndown padding) -> '- item'
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// All DOM normalisation that must happen before turndown, applied to whichever
// document actually gets serialized
function prepDocument(document: any, baseUrl?: string): void {
  if (baseUrl) {
    for (const a of document.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href")?.trim();
      if (href) {
        if (href.toLowerCase().startsWith("javascript:")) {
          a.removeAttribute("href");
        } else if (href.startsWith("#")) {
          // Heading anchors are meaningless once the page is flattened; unwrap them
          const parent = a.parentNode;
          if (parent) {
            for (const child of [...a.childNodes]) parent.insertBefore(child, a);
            a.remove();
          }
        } else if (!href.startsWith("data:") && !href.startsWith("mailto:")) {
          try {
            a.setAttribute("href", new URL(href, baseUrl).href);
          } catch {
            // keep existing href if URL resolution fails
          }
        }
      }
    }

    for (const img of document.querySelectorAll("img[src]")) {
      const src = img.getAttribute("src")?.trim();
      if (src && !src.startsWith("data:") && !src.startsWith("http://") && !src.startsWith("https://")) {
        try {
          img.setAttribute("src", new URL(src, baseUrl).href);
        } catch {
          // keep existing src if URL resolution fails
        }
      }
    }
  }

  // Drop site chrome up-front: Readability can select a container (#content) that
  // still wraps nav/footer, and the body fallback must not return mega-menu text
  stripChromeNodes(document);
  annotateCodeLanguage(document);

  // Icon-only / empty-text links convert to noise like `[](https://host/)`; drop them
  for (const a of document.querySelectorAll("a")) {
    const text = (a.textContent || "").replace(/\s+/g, " ").trim();
    const alt = a.querySelector("img[alt]")?.getAttribute("alt")?.trim() || "";
    if (!text && !alt) a.remove();
  }
}

export function extractMarkdownFromHtml(html: string, url?: string): ExtractionResult {
  if (!html || html.trim().length === 0) {
    return { markdown: "" };
  }

  // Pre-strip markup that turndown rules would delete anyway so the 200KB parse cap
  // measures content weight, not script/style/base64 bulk (tail articles survive)
  const leanHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/data:[^"'\s>]{100,}/gi, "data:truncated");

  // Cap giant HTML input to prevent regex/parser catastrophic backtracking
  const safeHtml = leanHtml.length > MAX_RAW_HTML_CHARS ? leanHtml.slice(0, MAX_RAW_HTML_CHARS) : leanHtml;
  const { document } = parseHTML(safeHtml);

  let baseUrl: string | undefined;
  try {
    baseUrl = url ? new URL(url).href : undefined;
  } catch {
    baseUrl = undefined; // Invalid baseUrl, continue without resolving relative URLs
  }

  prepDocument(document, baseUrl);

  // Attempt main article extraction via Readability
  try {
    const reader = new Readability(document);
    const parsed = reader.parse();

    if (parsed && parsed.content && parsed.content.trim().length > 0) {
      const rawMarkdown = turndownService.turndown(parsed.content);
      return {
        title: parsed.title ? parsed.title.trim() : undefined,
        markdown: cleanMarkdownWhitespace(rawMarkdown),
        meta: extractPageMeta(document),
      };
    }
  } catch {
    // Fallback if readability parsing throws
  }

  // Fallback: Readability found nothing usable. Re-parse (Readability mutates the DOM
  // it consumes) then take the densest content container instead of the whole body.
  const fallbackDoc = parseHTML(safeHtml).document;
  prepDocument(fallbackDoc, baseUrl);
  const fallbackHtml = pickContentRoot(fallbackDoc);
  const rawMarkdown = turndownService.turndown(fallbackHtml);

  const titleElement = fallbackDoc.querySelector("title");
  const title = titleElement ? titleElement.textContent?.trim() : undefined;

  return {
    title,
    markdown: cleanMarkdownWhitespace(rawMarkdown),
    meta: extractPageMeta(fallbackDoc),
  };
}

export interface SlicedResult {
  text: string;
  truncated: boolean;
  totalLength: number;
}

export function sliceContent(content: string, offset: number = 0, maxLength: number = 15000): SlicedResult {
  const totalLength = content.length;
  const safeOffset = Math.max(0, isNaN(offset) ? 0 : Math.floor(offset));
  const safeMax = Math.max(1, isNaN(maxLength) ? 15000 : Math.floor(maxLength));

  if (totalLength === 0) {
    return {
      text: "*Empty content returned from web page.*",
      truncated: false,
      totalLength: 0,
    };
  }

  if (safeOffset >= totalLength) {
    return {
      text: `*Offset (${offset}) exceeds total content length (${totalLength}). No more content.*`,
      truncated: false,
      totalLength,
    };
  }

  const end = Math.min(safeOffset + safeMax, totalLength);
  const sliced = content.slice(safeOffset, end);
  const truncated = end < totalLength;

  let text = sliced;
  if (truncated) {
    text += `\n\n---\n*Note: Content truncated. Showing characters ${safeOffset} to ${end} of ${totalLength}. Call web_fetch with offset=${end} to read next chunk.*`;
  }

  return {
    text,
    truncated,
    totalLength,
  };
}

export interface ProcessedResponse {
  title?: string;
  content: string;
  fullContent: string;
  truncated: boolean;
  totalLength: number;
}

export function processWebResponse(
  rawBody: string,
  contentType: string = "text/html",
  url: string = "",
  offset: number = 0,
  maxLength: number = 15000
): ProcessedResponse {
  const normalizedType = contentType.toLowerCase();

  // 1. Binary Content Check
  const binaryTypes = [
    "application/pdf",
    "application/zip",
    "application/octet-stream",
    "image/",
    "audio/",
    "video/",
    "application/vnd.",
  ];

  if (binaryTypes.some((bin) => normalizedType.includes(bin))) {
    const msg = `[Binary content detected (${contentType}). Reading binary files is not supported.]`;
    return {
      content: msg,
      fullContent: msg,
      truncated: false,
      totalLength: msg.length,
    };
  }

  // 2. JSON check
  if (normalizedType.includes("application/json")) {
    try {
      const parsed = JSON.parse(rawBody);
      const pretty = "```json\n" + JSON.stringify(parsed, null, 2) + "\n```";
      const sliced = sliceContent(pretty, offset, maxLength);
      return {
        content: sliced.text,
        fullContent: pretty,
        truncated: sliced.truncated,
        totalLength: sliced.totalLength,
      };
    } catch {
      const sliced = sliceContent(rawBody, offset, maxLength);
      return {
        content: sliced.text,
        fullContent: rawBody,
        truncated: sliced.truncated,
        totalLength: sliced.totalLength,
      };
    }
  }

  // 3. Plain text / Markdown
  if (normalizedType.includes("text/plain") || normalizedType.includes("text/markdown")) {
    const cleaned = normalizePlainText(rawBody);
    const sliced = sliceContent(cleaned, offset, maxLength);
    return {
      content: sliced.text,
      fullContent: cleaned,
      truncated: sliced.truncated,
      totalLength: sliced.totalLength,
    };
  }

  // 4. HTML (default)
  const extracted = extractMarkdownFromHtml(rawBody, url);
  if (!extracted.markdown || extracted.markdown.trim().length === 0) {
    const msg = "*Empty content returned from web page.*";
    return {
      title: extracted.title,
      content: msg,
      fullContent: msg,
      truncated: false,
      totalLength: msg.length,
    };
  }

  const fullText =
    buildFrontmatter({
      url,
      title: extracted.title,
      published: extracted.meta?.published,
      author: extracted.meta?.author,
      description: extracted.meta?.description,
    }) +
    (extracted.title && !extracted.markdown.startsWith(`# ${extracted.title}`)
      ? `# ${extracted.title}\n\n${extracted.markdown}`
      : extracted.markdown);

  const sliced = sliceContent(fullText, offset, maxLength);
  return {
    title: extracted.title,
    content: sliced.text,
    fullContent: fullText,
    truncated: sliced.truncated,
    totalLength: sliced.totalLength,
  };
}
