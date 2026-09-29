# pi-web-search

High-efficiency web search and content extraction extension for the [Pi coding agent](https://pi.dev).

## Features

- **SearXNG Integration**: Directly query your private or public SearXNG endpoint without third-party middleman services.
- **Two Distinct Tools**:
  - `web_search`: Search queries, ranked results, snippets, timestamps, and URLs.
  - `web_fetch`: Fetch specific web pages and convert to clean, readable Markdown.
- **Token & Runtime Efficient**:
  - Uses `@mozilla/readability` + `linkedom` + `turndown` to strip scripts, styles, navigation bars, sidebars, advertisements, and footers.
  - Fast native HTTP fetching with `AbortController` timeouts and browser impersonation headers.
  - Smart content-length truncation (~15,000 chars / ~3,500 tokens default) with `offset` support for reading long documents.
  - Smart Content-Type routing: HTML parsed via Readability, text/json/markdown passed directly, binary rejected with clear explanation.
  - **Automatic Disk Caching**: Full extracted Markdown is automatically cached to `~/.pi/cache/web_search/<slug>-<hash>.md` for instant inspection or grep across turns without context bloat or network re-fetching.

---

## Configuration

The extension strictly reads its configuration from:

```
~/.pi/agent/searxng.json
```

If the file does not exist when a tool is called, a template is automatically created with default placeholder values:

```json
{
  "endpoint": "http://localhost:8080",
  "apiKey": "",
  "categories": "general",
  "defaultEngines": "",
  "timeoutMs": 10000
}
```

> **Note on SearXNG**: Ensure JSON format is enabled in your SearXNG instance's `settings.yml`:
> ```yaml
> search:
>   formats:
>     - html
>     - json
> ```

---

## Installation

### Installation via Pi Package Manager

Run in your terminal or inside a Pi session:

```bash
pi install github:VJ-2303/pi-web-search
```

### Local Development / Manual Load

Load directly from local clone:

```bash
pi --extension ./src/index.ts
```

---

## Tool Details

### `web_search`

Search the web using SearXNG.

- **Parameters**:
  - `query` (string, required): The search terms.
  - `num_results` (integer, optional, default: 4): Number of results to return (1-20).
  - `categories` (string, optional): Comma-separated SearXNG categories (e.g. `general`, `it`, `science`).

### `web_fetch`

Retrieve a web page and convert it into concise, article-focused Markdown.

- **Parameters**:
  - `url` (string, required): Absolute HTTP or HTTPS URL.
  - `offset` (integer, optional, default: 0): Character offset to start reading from.
  - `max_length` (integer, optional, default: 15000): Maximum characters to return.

---

## Development

```bash
# Install dependencies
npm install

# Run test suite
npm test

# Typecheck TypeScript
npm run typecheck
```
