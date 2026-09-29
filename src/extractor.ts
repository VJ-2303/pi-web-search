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

export interface ExtractionResult {
  title?: string;
  markdown: string;
}

function cleanMarkdownWhitespace(md: string): string {
  return md.replace(/\n{3,}/g, "\n\n").trim();
}

export function extractMarkdownFromHtml(html: string, url?: string): ExtractionResult {
  if (!html || html.trim().length === 0) {
    return { markdown: "" };
  }

  // Cap giant HTML input to prevent regex/parser catastrophic backtracking
  const safeHtml = html.length > MAX_RAW_HTML_CHARS ? html.slice(0, MAX_RAW_HTML_CHARS) : html;
  const { document } = parseHTML(safeHtml);

  // Pre-process DOM: resolve relative URLs and clean javascript: hrefs
  if (url) {
    try {
      const baseUrl = new URL(url).href;
      for (const a of document.querySelectorAll("a[href]")) {
        const href = a.getAttribute("href")?.trim();
        if (href) {
          if (href.toLowerCase().startsWith("javascript:")) {
            a.removeAttribute("href");
          } else if (!href.startsWith("#") && !href.startsWith("data:") && !href.startsWith("mailto:")) {
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
    } catch {
      // Invalid baseUrl, continue without resolving relative URLs
    }
  }

  // Attempt main article extraction via Readability
  try {
    const reader = new Readability(document);
    const parsed = reader.parse();

    if (parsed && parsed.content && parsed.content.trim().length > 0) {
      const rawMarkdown = turndownService.turndown(parsed.content);
      return {
        title: parsed.title ? parsed.title.trim() : undefined,
        markdown: cleanMarkdownWhitespace(rawMarkdown),
      };
    }
  } catch {
    // Fallback if readability parsing throws
  }

  // Fallback: extract entire body if readability didn't find an article
  const fallbackHtml = document.body?.innerHTML || document.toString() || safeHtml;
  const rawMarkdown = turndownService.turndown(fallbackHtml);

  const titleElement = document.querySelector("title");
  const title = titleElement ? titleElement.textContent?.trim() : undefined;

  return {
    title,
    markdown: cleanMarkdownWhitespace(rawMarkdown),
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
      };
    } catch {
      const sliced = sliceContent(rawBody, offset, maxLength);
      return {
        content: sliced.text,
        fullContent: rawBody,
        truncated: sliced.truncated,
      };
    }
  }

  // 3. Plain text / Markdown
  if (normalizedType.includes("text/plain") || normalizedType.includes("text/markdown")) {
    const sliced = sliceContent(rawBody, offset, maxLength);
    return {
      content: sliced.text,
      fullContent: rawBody,
      truncated: sliced.truncated,
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
    };
  }

  const fullText = extracted.title && !extracted.markdown.startsWith(`# ${extracted.title}`)
    ? `# ${extracted.title}\n\n${extracted.markdown}`
    : extracted.markdown;

  const sliced = sliceContent(fullText, offset, maxLength);
  return {
    title: extracted.title,
    content: sliced.text,
    fullContent: fullText,
    truncated: sliced.truncated,
  };
}
