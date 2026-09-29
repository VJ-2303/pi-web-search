import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

export function getDefaultCacheDir(): string {
  return path.join(os.homedir(), ".pi", "cache", "web_search");
}

export function getCacheFilename(url: string): string {
  try {
    const parsed = new URL(url);
    const combined = (parsed.hostname + parsed.pathname)
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    const hash = crypto.createHash("sha256").update(url).digest("hex").slice(0, 8);
    const slug = combined || "page";
    return `${slug}-${hash}.md`;
  } catch {
    const hash = crypto.createHash("sha256").update(url).digest("hex").slice(0, 8);
    return `page-${hash}.md`;
  }
}

export interface CacheSaveResult {
  filePath: string;
  charCount: number;
}

export function saveToCache(
  url: string,
  content: string,
  customCacheDir?: string
): CacheSaveResult {
  const cacheDir = customCacheDir || getDefaultCacheDir();

  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const filename = getCacheFilename(url);
  const filePath = path.join(cacheDir, filename);

  fs.writeFileSync(filePath, content, "utf-8");

  return {
    filePath,
    charCount: content.length,
  };
}
