import { Type } from "@sinclair/typebox";
import { loadConfig } from "./config.js";
import { searchSearxng } from "./searxng.js";
import { fetchUrl } from "./fetcher.js";
import { processWebResponse } from "./extractor.js";

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
  // 1. web_search Tool
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web using user-configured SearXNG instance. Returns a ranked list of relevant pages with links and concise snippets.",
    parameters: Type.Object({
      query: Type.String({
        description: "Search query string",
      }),
      num_results: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 20,
          default: 6,
          description: "Number of search results to return (default: 6)",
        })
      ),
      time_range: Type.Optional(
        Type.Union(
          [
            Type.Literal("day"),
            Type.Literal("week"),
            Type.Literal("month"),
            Type.Literal("year"),
          ],
          {
            description: "Optional time range constraint: day, week, month, or year",
          }
        )
      ),
      categories: Type.Optional(
        Type.String({
          description: "Optional SearXNG category (e.g. general, it, science, news)",
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
      "Fetch content from a web URL and extract clean, readable markdown stripped of navigation, boilerplate, ads, and footers.",
    parameters: Type.Object({
      url: Type.String({
        description: "Absolute HTTP/HTTPS URL of the web page to fetch",
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
          description: "Maximum number of characters to return (default: 15000 / ~3500 tokens)",
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

      return {
        content: [{ type: "text", text: processed.content }],
        details: {
          url: fetched.url,
          title: processed.title,
          truncated: processed.truncated,
        },
      };
    },
  });
}
