import type { SearxngConfig } from "./config.js";

export interface SearchParams {
  query: string;
  num_results?: number;
  categories?: string;
}

export interface SearchResultItem {
  title: string;
  url: string;
  content: string;
  publishedDate?: string;
  engine?: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResultItem[];
  markdown: string;
}

export function formatSearchResults(query: string, results: SearchResultItem[]): string {
  if (results.length === 0) {
    return `No results found for "${query}".`;
  }

  const lines: string[] = [`### Search Results for "${query}" (${results.length} results)\n`];

  results.forEach((item, index) => {
    lines.push(`${index + 1}. **[${item.title || "Untitled"}](${item.url})**`);
    if (item.content) {
      const cleanSnippet = item.content.replace(/\s+/g, " ").trim();
      lines.push(`   > ${cleanSnippet}`);
    }
    if (item.publishedDate) {
      lines.push(`   *Date: ${item.publishedDate}*`);
    }
    lines.push("");
  });

  return lines.join("\n").trim();
}

export async function searchSearxng(
  config: SearxngConfig,
  params: SearchParams,
  signal?: AbortSignal
): Promise<SearchResponse> {
  const query = params.query.trim();
  if (!query) {
    throw new Error("Search query cannot be empty");
  }

  const url = new URL(`${config.endpoint}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");

  const categories = params.categories || config.categories;
  if (categories) {
    url.searchParams.set("categories", categories);
  }

  if (config.defaultEngines) {
    url.searchParams.set("engines", config.defaultEngines);
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  };

  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  const timeoutMs = config.timeoutMs || 10000;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      headers,
      signal: combinedSignal,
    });
  } catch (err: any) {
    if (err.name === "TimeoutError") {
      throw new Error(`SearXNG request timed out after ${timeoutMs}ms`);
    }
    throw new Error(`Failed to connect to SearXNG at ${config.endpoint}: ${err.message}`);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    if (
      response.status === 403 &&
      (errorText.toLowerCase().includes("json") || errorText.toLowerCase().includes("format"))
    ) {
      throw new Error(
        `SearXNG instance disabled JSON format (HTTP 403).\n` +
          `Please enable 'json' format in your SearXNG settings.yml: search.formats: [html, json]`
      );
    }
    throw new Error(`SearXNG returned error ${response.status} ${response.statusText}: ${errorText}`);
  }

  const data = (await response.json()) as { results?: any[] };
  const rawResults = Array.isArray(data.results) ? data.results : [];
  const limit = params.num_results && params.num_results > 0 ? params.num_results : 4;
  const sliced = rawResults.slice(0, limit);

  const results: SearchResultItem[] = sliced.map((item) => ({
    title: String(item.title || "").trim(),
    url: String(item.url || "").trim(),
    content: String(item.content || "").trim(),
    publishedDate: item.publishedDate ? String(item.publishedDate) : undefined,
    engine: item.engine ? String(item.engine) : undefined,
  }));

  const markdown = formatSearchResults(query, results);

  return {
    query,
    results,
    markdown,
  };
}
