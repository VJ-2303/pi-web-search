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

export function cleanSnippetText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatSearchResults(query: string, results: SearchResultItem[]): string {
  if (results.length === 0) {
    return `No results found for "${query}".`;
  }

  const lines: string[] = [`### Search Results for "${query}" (${results.length} results)\n`];

  results.forEach((item, index) => {
    const cleanTitle = cleanSnippetText(item.title || "Untitled").replace(/([\[\]])/g, "\\$1");
    const safeUrl = item.url.replace(/\(/g, "%28").replace(/\)/g, "%29");
    lines.push(`${index + 1}. **[${cleanTitle}](${safeUrl})**`);
    if (item.content) {
      const cleanSnippet = cleanSnippetText(item.content);
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

export interface HealthResult {
  healthy: boolean;
  status: number;
  latencyMs: number;
  message: string;
  jsonEnabled: boolean;
}

export async function checkSearxngHealth(
  config: SearxngConfig,
  signal?: AbortSignal
): Promise<HealthResult> {
  const timeoutMs = config.timeoutMs || 5000;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  const url = new URL(`${config.endpoint}/search`);
  url.searchParams.set("q", "ping");
  url.searchParams.set("format", "json");

  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  };
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  const start = performance.now();
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      headers,
      signal: combinedSignal,
    });
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - start);
    return {
      healthy: false,
      status: 0,
      latencyMs,
      message: `Failed to connect: ${err.message}`,
      jsonEnabled: false,
    };
  }

  const latencyMs = Math.round(performance.now() - start);

  if (!response.ok) {
    const errorText =
      typeof response.text === "function" ? await response.text().catch(() => "") : "";
    const isJsonDisabled =
      response.status === 403 &&
      (errorText.toLowerCase().includes("json") || errorText.toLowerCase().includes("format"));
    return {
      healthy: false,
      status: response.status,
      latencyMs,
      message: isJsonDisabled
        ? "SearXNG JSON format disabled. Enable 'json' in SearXNG settings.yml (search.formats: [html, json])"
        : `SearXNG returned HTTP ${response.status}: ${errorText || response.statusText}`,
      jsonEnabled: !isJsonDisabled,
    };
  }

  try {
    await response.json();
    return {
      healthy: true,
      status: 200,
      latencyMs,
      message: `SearXNG is healthy (${latencyMs}ms)`,
      jsonEnabled: true,
    };
  } catch {
    return {
      healthy: false,
      status: response.status,
      latencyMs,
      message: "SearXNG returned non-JSON response. JSON format disabled in settings.yml",
      jsonEnabled: false,
    };
  }
}

