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

const NAMED_ENTITIES: Record<string, string> = {
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201d",
  ldquo: "\u201c",
  hellip: "\u2026",
  mdash: "\u2014",
  ndash: "\u2013",
};

function decodeCodePoint(cp: number): string {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
}

export function cleanSnippetText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => decodeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => decodeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match: string, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match)
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const MAX_SNIPPET_CHARS = 300;

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
      let cleanSnippet = cleanSnippetText(item.content);
      if (cleanSnippet.length > MAX_SNIPPET_CHARS) {
        cleanSnippet = `${cleanSnippet.slice(0, MAX_SNIPPET_CHARS).trimEnd()}…`;
      }
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

  let data: { results?: any[]; infoboxes?: any[] };
  try {
    data = (await response.json()) as { results?: any[]; infoboxes?: any[] };
  } catch {
    throw new Error(
      "SearXNG returned a non-JSON response. The instance may be behind a proxy or blocking requests; verify the endpoint with /searxng status."
    );
  }

  const rawResults: any[] = [];

  // Include infoboxes (e.g. Wikipedia knowledge cards) at top
  if (Array.isArray(data.infoboxes)) {
    for (const info of data.infoboxes) {
      const infoUrl = info.urls?.[0]?.url || info.id;
      if (infoUrl) {
        rawResults.push({
          title: info.infobox || info.urls?.[0]?.title || "Infobox",
          url: infoUrl,
          content: info.content || "",
          engine: info.engine || "infobox",
        });
      }
    }
  }

  if (Array.isArray(data.results)) {
    rawResults.push(...data.results);
  }

  const seen = new Set<string>();
  const unique: any[] = [];
  for (const item of rawResults) {
    const url = String(item.url || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    unique.push(item);
  }

  const limit = params.num_results && params.num_results > 0 ? params.num_results : 4;
  const sliced = unique.slice(0, limit);

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

