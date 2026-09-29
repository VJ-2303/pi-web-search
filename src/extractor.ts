import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  hr: "---",
  bulletListMarker: "-",
});

// Remove images, scripts, styles, iframes from turndown output to save tokens
turndownService.addRule("stripUnwantedTags", {
  filter: ["script", "style", "noscript", "svg", "iframe", "object", "embed"],
  replacement: () => "",
});

export interface ExtractionResult {
  title?: string;
  markdown: string;
}

export function extractMarkdownFromHtml(html: string, url?: string): ExtractionResult {
  const { document } = parseHTML(html);

  // Attempt main article extraction via Readability
  try {
    const reader = new Readability(document);
    const parsed = reader.parse();

    if (parsed && parsed.content) {
      const markdown = turndownService.turndown(parsed.content).trim();
      return {
        title: parsed.title || undefined,
        markdown,
      };
    }
  } catch {
    // Fallback if readability parsing throws
  }

  // Fallback: extract entire body if readability didn't find an article
  const body = document.body || document;
  const fallbackHtml = body.innerHTML || html;
  const markdown = turndownService.turndown(fallbackHtml).trim();

  const titleElement = document.querySelector("title");
  const title = titleElement ? titleElement.textContent?.trim() : undefined;

  return {
    title,
    markdown,
  };
}

export interface SlicedResult {
  text: string;
  truncated: boolean;
  totalLength: number;
}

export function sliceContent(content: string, offset: number = 0, maxLength: number = 15000): SlicedResult {
  const totalLength = content.length;
  const start = Math.max(0, offset);

  if (start >= totalLength) {
    return {
      text: `*Offset (${offset}) exceeds total content length (${totalLength}). No more content.*`,
      truncated: false,
      totalLength,
    };
  }

  const end = Math.min(start + maxLength, totalLength);
  const sliced = content.slice(start, end);
  const truncated = end < totalLength;

  let text = sliced;
  if (truncated) {
    text += `\n\n---\n*Note: Content truncated. Showing characters ${start} to ${end} of ${totalLength}. Call web_fetch with offset=${end} to read next chunk.*`;
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
    return {
      content: `[Binary content detected (${contentType}). Reading binary files is not supported.]`,
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
        truncated: sliced.truncated,
      };
    } catch {
      const sliced = sliceContent(rawBody, offset, maxLength);
      return { content: sliced.text, truncated: sliced.truncated };
    }
  }

  // 3. Plain text / Markdown
  if (normalizedType.includes("text/plain") || normalizedType.includes("text/markdown")) {
    const sliced = sliceContent(rawBody, offset, maxLength);
    return {
      content: sliced.text,
      truncated: sliced.truncated,
    };
  }

  // 4. HTML (default)
  const extracted = extractMarkdownFromHtml(rawBody, url);
  const fullText = extracted.title && !extracted.markdown.startsWith(`# ${extracted.title}`)
    ? `# ${extracted.title}\n\n${extracted.markdown}`
    : extracted.markdown;

  const sliced = sliceContent(fullText, offset, maxLength);
  return {
    title: extracted.title,
    content: sliced.text,
    truncated: sliced.truncated,
  };
}
