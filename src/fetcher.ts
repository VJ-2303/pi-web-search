export interface FetchResponse {
  text: string;
  contentType: string;
  status: number;
  url: string;
}

const BROWSER_HEADERS: Record<string, string> = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain,application/json,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

const MAX_FETCH_BYTES = 5_000_000; // 5 MB body cap
const MAX_ERROR_EXCERPT_CHARS = 200; // snippet of error page body shown in messages

function charsetFromContentType(contentType: string): string | undefined {
  const m = /charset\s*=\s*"?([\w:.-]+)"?/i.exec(contentType);
  return m ? m[1] : undefined;
}

// HTML sniffing only ever needs the leading bytes; meta charset is always near the top
function charsetFromMetaHead(headBytes: Uint8Array): string | undefined {
  const ascii = new TextDecoder("ascii", { fatal: false }).decode(headBytes.slice(0, 2048));
  const m = /<meta[^>]+charset\s*=\s*["']?([\w:.-]+)/i.exec(ascii);
  return m ? m[1] : undefined;
}

function decodeBody(bytes: Uint8Array, declaredCharset?: string): string {
  const candidates = [declaredCharset, charsetFromMetaHead(bytes), "utf-8"].filter(
    (c): c is string => Boolean(c)
  );
  for (const label of candidates) {
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      // unknown/unsupported label, try the next candidate
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

export async function fetchUrl(
  url: string,
  timeoutMs: number = 15000,
  signal?: AbortSignal
): Promise<FetchResponse> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid URL protocol: "${parsed.protocol}". Only http: and https: are supported.`);
  }

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: BROWSER_HEADERS,
      signal: combinedSignal,
      redirect: "follow",
    });
  } catch (err: any) {
    if (err.name === "TimeoutError") {
      throw new Error(`Fetch timed out after ${timeoutMs}ms: ${url}`);
    }
    throw new Error(`Failed to fetch ${url}: ${err.message}`);
  }

  if (!response.ok) {
    const bodySnippet = await response
      .text()
      .then((t) =>
        t
          .replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, MAX_ERROR_EXCERPT_CHARS)
      )
      .catch(() => "");
    const detail = bodySnippet ? ` — ${bodySnippet}` : "";
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status} ${response.statusText}${detail}`);
  }

  const contentType = response.headers.get("content-type") || "text/html";
  const declaredCharset = charsetFromContentType(contentType);

  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_FETCH_BYTES) {
    throw new Error(
      `Response body too large (${declaredLength} bytes, limit ${MAX_FETCH_BYTES}). URL: ${url}`
    );
  }

  let text: string;
  if (response.body && typeof response.body.getReader === "function") {
    // Stream-cap so oversized bodies are aborted without full buffering
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_FETCH_BYTES) {
        reader.cancel().catch(() => {});
        throw new Error(
          `Response body too large (>${MAX_FETCH_BYTES} bytes). URL: ${url}`
        );
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(received);
    let pos = 0;
    for (const chunk of chunks) {
      merged.set(chunk, pos);
      pos += chunk.byteLength;
    }
    text = decodeBody(merged, declaredCharset);
  } else {
    text = await response.text();
    if (text.length > MAX_FETCH_BYTES) {
      throw new Error(
        `Response body too large (>${MAX_FETCH_BYTES} bytes). URL: ${url}`
      );
    }
  }

  return {
    text,
    contentType,
    status: response.status,
    url: response.url || url,
  };
}
