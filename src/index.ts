import { Type } from "@sinclair/typebox";
import { loadConfig, ensureConfigFile } from "./config.js";
import { searchSearxng } from "./searxng.js";
import { fetchUrl } from "./fetcher.js";
import { processWebResponse } from "./extractor.js";
import { saveToCache } from "./cache.js";

// Minimal interface matching Pi ExtensionAPI tool registration
export interface ExtensionAPI {
  registerTool(tool: {
    name: string;
    label?: string;
    description: string;
    parameters: any;
    annotations?: {
      readOnlyHint?: boolean;
      destructiveHint?: boolean;
      idempotentHint?: boolean;
      openWorldHint?: boolean;
    };
    execute: (
      toolCallId: string,
      params: any,
      signal?: AbortSignal,
      onUpdate?: (update: any) => void,
      ctx?: any
    ) => Promise<{
      content: Array<{ type: "text"; text: string }>;
      details?: Record<string, any>;
    }>;
  }): void;
}

export default function registerExtension(pi: ExtensionAPI): void {
  // Ensure ~/.pi/agent/searxng.json template exists immediately upon extension load
  try {
    ensureConfigFile();
  } catch {
    // Non-blocking if directory permissions or environment restrict file writes
  }

  // 1. web_search Tool
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web using SearXNG. Returns a ranked list of relevant results with titles, URLs, and concise snippets. Use this tool first to discover sources before fetching full articles with web_fetch.",
    parameters: Type.Object({
      query: Type.String({
        description: "Specific search query terms or keywords",
      }),
      num_results: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 20,
          default: 4,
          description: "Number of search results to return (default: 4, min: 1, max: 20)",
        })
      ),
      categories: Type.Optional(
        Type.String({
          description: "Optional SearXNG category filter (e.g. 'general', 'it', 'science', 'news')",
        })
      ),
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      idempotentHint: true,
    },
    execute: async (_toolCallId, params, signal) => {
      const config = loadConfig();
      const response = await searchSearxng(config, params, signal);
      return {
        content: [{ type: "text", text: response.markdown }],
        details: {
          query: response.query,
          resultCount: response.results.length,
          results: response.results,
        },
      };
    },
  });

  // 2. web_fetch Tool
  pi.registerTool({
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch an HTTP/HTTPS URL and convert its main content to clean, token-efficient Markdown. Automatically strips scripts, styles, navigation bars, ads, and footers, and caches the full document to disk for reuse. When content is truncated, call again with the provided offset to read subsequent sections.",
    parameters: Type.Object({
      url: Type.String({
        description: "Full HTTP or HTTPS URL to fetch",
      }),
      offset: Type.Optional(
        Type.Integer({
          minimum: 0,
          default: 0,
          description: "Character offset to start reading from for paginating long content (default: 0)",
        })
      ),
      max_length: Type.Optional(
        Type.Integer({
          minimum: 500,
          maximum: 50000,
          default: 15000,
          description: "Maximum number of characters to return per request (default: 15000 / ~3500 tokens)",
        })
      ),
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      idempotentHint: true,
    },
    execute: async (_toolCallId, params, signal) => {
      const config = loadConfig();
      const timeoutMs = config.timeoutMs || 15000;
      const fetched = await fetchUrl(params.url, timeoutMs, signal);
      const processed = processWebResponse(
        fetched.text,
        fetched.contentType,
        fetched.url,
        params.offset || 0,
        params.max_length || 15000
      );

      const cacheResult = saveToCache(fetched.url, processed.fullContent);
      const cacheNotice = `*Cached full content (${cacheResult.charCount.toLocaleString()} chars) to: ${cacheResult.filePath}*\n\n`;

      return {
        content: [{ type: "text", text: cacheNotice + processed.content }],
        details: {
          url: fetched.url,
          title: processed.title,
          truncated: processed.truncated,
          cachedFilePath: cacheResult.filePath,
          totalChars: cacheResult.charCount,
        },
      };
    },
  });
}
