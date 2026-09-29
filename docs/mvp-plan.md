# MVP Plan: `pi-web-search`

Distributable web search and content extraction extension package for the Pi coding agent (`pi.dev`).

---

## 1. Objectives & Key Constraints

- **High Speed / Low Latency**: Native `fetch` with strict timeouts (`AbortController`), lightweight DOM parsing via `linkedom` (~10x faster/lighter than JSDOM).
- **Token Efficiency**: Clean markdown only via `@mozilla/readability` and `turndown`. No boilerplate, ads, navigation, headers, or footers. Configurable cap (~15,000 chars / ~3,500 tokens) with offset-based pagination.
- **Privacy & Self-Hosting**: Direct communication with user-provided SearXNG instance without third-party middleware.
- **Pi Compatibility**: Built as a distributable `pi-package` ready for `pi install`. Follows official Pi Extension API conventions (`@earendil-works/pi-coding-agent`, `typebox`).

---

## 2. Package Architecture

```text
pi-web-search/
├── docs/
│   └── mvp-plan.md
├── src/
│   ├── config.ts         # SearXNG config loader, validation & template generator
│   ├── searxng.ts        # SearXNG HTTP client & response normalizer
│   ├── fetcher.ts        # HTTP fetcher with browser headers & timeout
│   ├── extractor.ts      # Linkedom + Readability + Turndown parser & token guard
│   └── index.ts          # Pi extension entrypoint registering web_search & web_fetch
├── tests/
│   ├── config.test.ts
│   ├── searxng.test.ts
│   ├── fetcher.test.ts
│   └── extractor.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### Manifest (`package.json`)
- `keywords`: `["pi-package"]`
- `pi`:
  ```json
  {
    "extensions": ["./src/index.ts"]
  }
  ```
- `peerDependencies`:
  - `@earendil-works/pi-coding-agent`: `*`
  - `typebox`: `*`
- `dependencies`:
  - `@mozilla/readability`: `^0.5.0`
  - `linkedom`: `^0.18.5`
  - `turndown`: `^7.2.0`
- `devDependencies`:
  - `vitest`: `^3.0.0`
  - `typescript`: `^5.7.0`
  - `@types/node`: `^22.0.0`
  - `@types/turndown`: `^7.0.5`
  - `@types/mozilla__readability`: `^0.2.5`

---

## 3. Configuration Contract

- **Config Path**: `~/.pi/agent/searxng.json`
- **Schema**:
  ```json
  {
    "endpoint": "http://localhost:8080",
    "apiKey": "",
    "categories": "general",
    "defaultEngines": "",
    "timeoutMs": 10000
  }
  ```
- **Lifecycle Behavior**:
  - If file is missing on tool invocation:
    1. Automatically create directory and file with template values.
    2. Throw descriptive error instructing user to verify endpoint in `~/.pi/agent/searxng.json`.
  - Endpoint trailing slashes are trimmed automatically.

---

## 4. Tool Specifications

### Tool 1: `web_search`
- **Description**: Search the web using a SearXNG instance. Returns a ranked list of relevant results with snippets and links.
- **Parameters (TypeBox)**:
  - `query` (`Type.String({ description: "Search query string" })`): Required.
  - `num_results` (`Type.Optional(Type.Integer({ minimum: 1, maximum: 20, default: 4, description: "Number of search results to return" }))`): Optional.
  - `categories` (`Type.Optional(Type.String({ description: "Comma-separated SearXNG categories, e.g. general, it, science" }))`): Optional.
- **Output Format**:
  Markdown list formatted for token economy:
  ```markdown
  ### Search Results for "<query>" (4 results)

  1. **[Page Title](https://example.com/page1)**
     > Concise snippet text from SearXNG describing content...
     *Date: 2026-03-15*

  2. **[Second Result](https://example.com/page2)**
     > Snippet text...
  ```

### Tool 2: `web_fetch`
- **Description**: Fetch content from a URL and extract clean, readable markdown stripped of navigation, advertisements, and footers.
- **Parameters (TypeBox)**:
  - `url` (`Type.String({ description: "Absolute HTTP/HTTPS URL to fetch" })`): Required.
  - `offset` (`Type.Optional(Type.Integer({ minimum: 0, default: 0, description: "Character offset to start reading from" }))`): Optional.
  - `max_length` (`Type.Optional(Type.Integer({ minimum: 500, maximum: 50000, default: 15000, description: "Maximum number of characters to return" }))`): Optional.
- **Processing Logic**:
  1. Inspect `Content-Type` response header:
     - `text/html`: Parse with `linkedom` DOM parser, extract main content via `@mozilla/readability`, convert cleaned article HTML to markdown with `turndown`.
     - `text/plain`, `text/markdown`, `application/json`: Return raw text directly (wrapped in code fences if JSON).
     - Binary (`application/pdf`, `image/*`, etc.): Return explanatory rejection message.
  2. Slicing & Pagination:
     - Slice string from `offset` up to `offset + max_length`.
     - If remaining content exists, append pagination banner:
       ```markdown
       ---
       *Note: Content truncated. Showing characters 0 to 15000 of 42300. Call web_fetch with offset=15000 to read next chunk.*
       ```
  3. Disk Caching:
     - Automatically cache full extracted Markdown document to `~/.pi/cache/web_search/<slug>-<hash>.md`.
     - Prepend cache path banner to returned content and include `cachedFilePath` in result `details`.

---

## 5. Resilience & Runtime Optimizations

1. **Browser Impersonation**: Set standard headers (`User-Agent`, `Accept`, `Accept-Language`) to prevent Cloudflare/WAF bot false positives.
2. **Strict Timeouts**: Default 10s for SearXNG queries, 15s for web fetches using `AbortSignal.timeout()`.
3. **Error Handling**:
   - `403 Format json not enabled`: Explicit guidance explaining `search.formats: [html, json]` in SearXNG `settings.yml`.
   - Network failure / DNS resolution: Concise error message without leaking stack traces into LLM context.

---

## 6. TDD Vertical Slices (Implementation Steps)

1. **Slice 1: Configuration Manager (`src/config.ts`)**
   - RED: Test reading config file, handling missing file by auto-creating template, parsing fields.
   - GREEN: Implement `loadConfig(configPath?)`.
   - REFACTOR: Clean up path resolution.

2. **Slice 2: SearXNG Client (`src/searxng.ts`)**
   - RED: Test query parameter serialization, timeout abort, JSON response parsing, and markdown result formatting.
   - GREEN: Implement `searchSearxng(config, params)`.
   - REFACTOR: Optimize markdown builder for token compactness.

3. **Slice 3: Fetcher & Content Extractor (`src/extractor.ts`)**
   - RED: Test HTML extraction using Readability + Turndown (stripping nav/ad elements), non-HTML routing, and offset/max_length truncation.
   - GREEN: Implement `extractContent(htmlOrText, contentType, options)`.
   - REFACTOR: Tune Turndown rules (clean link formatting, compact whitespace).

4. **Slice 4: Extension Assembly & Tool Registration (`src/index.ts`)**
   - RED: Test Pi extension factory registering `web_search` and `web_fetch` with TypeBox schema contracts.
   - GREEN: Wire `execute()` handlers calling `searxng.ts` and `extractor.ts`.
   - REFACTOR: Finalize error messaging and tool annotations (`readOnlyHint: true`, `openWorldHint: true`).

5. **Slice 5: Verification & Package Setup**
   - Run complete test suite (`vitest run`).
   - Validate `package.json` package manifest for `pi install`.
