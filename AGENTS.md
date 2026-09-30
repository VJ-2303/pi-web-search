# AGENTS.md

Instructions and technical reference for AI agents working in this repository.

## Repository Overview

`pi-web-search` is a high-efficiency web search and content extraction extension for the Pi coding agent (`pi.dev`), connecting directly to a SearXNG instance.

- **Tools Provided**:
  - `web_search`: Queries SearXNG (`/search?format=json`), returns compact markdown with ranked results, URLs, and snippets.
  - `web_fetch`: Retrieves web pages, extracts article content to clean Markdown via `@mozilla/readability` + `linkedom` + `turndown`, slices long documents, and caches full content to disk.
- **Slash Commands**:
  - `/searxng config`: Interactive terminal UI for configuring SearXNG settings.
  - `/searxng status`: Health diagnostic measuring connection, latency, and JSON API support.

## Architecture and Core Modules

```
src/
├── index.ts     # Extension entry point; registers tools and commands with Pi
├── config.ts    # Config loader, saver, and template generator (~/.pi/agent/searxng.json)
├── searxng.ts   # SearXNG client, query builder, snippet sanitizer, health check
├── fetcher.ts   # Native fetch wrapper with browser headers, timeouts, AbortSignal
├── extractor.ts # HTML parsing (linkedom), Readability, Turndown, URL resolution, slicing
├── cache.ts     # Disk caching to ~/.pi/cache/web_search/<slug>-<hash>.md
└── commands.ts  # Handlers for /searxng config and /searxng status
```

### Key Design Invariants

- **Zero-token Waste**:
  - `web_search` strips raw HTML tags and entities from snippets. Default returns 4 results.
  - `web_fetch` strips scripts, styles, iframes, and inline base64 image data URIs (`data:image/...`).
  - Raw HTML cap in `src/extractor.ts`: `MAX_RAW_HTML_CHARS = 200_000` to prevent DOM parsing stalls.
  - Non-HTML routing: Plain text and markdown passed through; JSON pretty-printed; binary content rejected early.
- **Relative URL Resolution**:
  - All relative links (`<a href>`) and image sources (`<img src>`) resolved against base URL.
  - `javascript:` URLs stripped.
- **Transparent Disk Caching**:
  - `web_fetch` caches full extracted markdown to `~/.pi/cache/web_search/<slug>-<hash>.md`.
  - Cache notice returned in tool output so agent knows where full content lives.
- **Config Initialization**:
  - `ensureConfigFile()` runs at startup in `registerExtension()`. Creates `~/.pi/agent/searxng.json` template non-destructively if missing.

## Pi Extension Specifications

### Package Manifest (`package.json`)

- `keywords`: Must include `"pi-package"`.
- `type`: `"module"`.
- `main`: Points to TypeScript source (e.g. `"./src/index.ts"`). Pi loads TypeScript directly via embedded runtime (jiti); no build step or `dist/` compilation needed.
- `pi.extensions`: Array of entry point paths:
  ```json
  "pi": {
    "extensions": ["./src/index.ts"]
  }
  ```
- `peerDependencies`: `@earendil-works/pi-coding-agent`, `typebox`.
- Distribution: Users install via `pi install https://github.com/VJ-2303/pi-web-search`. Do not use `github:` shorthand (treated as local relative path by Pi).

### Extension Registration API

The default export in `src/index.ts` must be a factory function:

```typescript
export default function registerExtension(pi: ExtensionAPI): void;
```

#### Tool Registration (`pi.registerTool`)

```typescript
pi.registerTool({
  name: "tool_name",
  label: "Human Readable Label",
  description: "Prompt for LLM explaining when and how to call the tool",
  parameters: Type.Object({ ... }), // TypeBox schema
  annotations: {
    readOnlyHint: true,    // Tool only reads state
    openWorldHint: true,   // Tool interacts with outside world (network)
    idempotentHint: true,  // Safe to retry
    destructiveHint: false // Tool does not destroy user data
  },
  execute: async (toolCallId, params, signal, onUpdate, ctx) => {
    return {
      content: [{ type: "text", text: "Markdown output for model" }],
      details: { /* structured metadata stored in session */ },
    };
  }
});
```

#### Slash Command Registration (`pi.registerCommand`)

```typescript
pi.registerCommand("command_name", {
  description: "Command description for slash command picker",
  handler: async (args: string, ctx: ExtensionCommandContext) => {
    // Interactive UI available via ctx.ui:
    // ctx.ui.select(title, options)
    // ctx.ui.input(title, placeholder)
    // ctx.ui.confirm(title, message)
    // ctx.ui.notify(message, "info" | "warning" | "error")
    // ctx.ui.editor(title, prefill)
  }
});
```

## Development and Verification

- **Package Manager**: npm.
- **Run Tests**: `npm test` (Vitest). All 61+ tests must pass before committing.
- **Type Checking**: `npm run typecheck` (`tsc --noEmit`). Must produce 0 errors.
- **Local Testing in Pi**:
  ```bash
  pi --extension ./src/index.ts
  ```
- **TDD Workflow**:
  - Always write failing test first (RED) in `tests/`.
  - Implement minimum change to pass (GREEN).
  - Refactor cleanly with suite remaining green.
  - Never add unrequested dependencies or speculative abstractions.
