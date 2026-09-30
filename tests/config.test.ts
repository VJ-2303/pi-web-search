import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadConfig, ensureConfigFile, getDefaultConfigPath } from "../src/config.js";

describe("Configuration Manager", () => {
  let tmpDir: string;
  let testConfigPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-search-test-"));
    testConfigPath = path.join(tmpDir, "searxng.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads existing config file and trims trailing slash from endpoint", () => {
    const configData = {
      endpoint: "http://localhost:8888/",
      apiKey: "secret123",
      categories: "general,it",
      timeoutMs: 8000,
    };
    fs.writeFileSync(testConfigPath, JSON.stringify(configData), "utf-8");

    const config = loadConfig(testConfigPath);
    expect(config.endpoint).toBe("http://localhost:8888");
    expect(config.apiKey).toBe("secret123");
    expect(config.categories).toBe("general,it");
    expect(config.timeoutMs).toBe(8000);
  });

  it("creates template config and throws error when file does not exist", () => {
    expect(fs.existsSync(testConfigPath)).toBe(false);

    expect(() => loadConfig(testConfigPath)).toThrow(/SearXNG config not found/);
    expect(fs.existsSync(testConfigPath)).toBe(true);

    const created = JSON.parse(fs.readFileSync(testConfigPath, "utf-8"));
    expect(created.endpoint).toBe("http://localhost:8080");
  });

  it("throws error when config has invalid endpoint", () => {
    fs.writeFileSync(testConfigPath, JSON.stringify({ endpoint: 123 }), "utf-8");
    expect(() => loadConfig(testConfigPath)).toThrow(/missing or invalid "endpoint"/);
  });

  it("throws error when config file contains malformed JSON", () => {
    fs.writeFileSync(testConfigPath, "{ endpoint: broken json }", "utf-8");
    expect(() => loadConfig(testConfigPath)).toThrow();
  });

  it("creates deeply nested directories if parent path does not exist", () => {
    const deepPath = path.join(tmpDir, "level1", "level2", "searxng.json");
    expect(() => loadConfig(deepPath)).toThrow(/SearXNG config not found/);
    expect(fs.existsSync(deepPath)).toBe(true);
  });

  it("creates template without throwing using ensureConfigFile", () => {
    expect(fs.existsSync(testConfigPath)).toBe(false);
    const created = ensureConfigFile(testConfigPath);
    expect(created).toBe(testConfigPath);
    expect(fs.existsSync(testConfigPath)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(testConfigPath, "utf-8"));
    expect(parsed.endpoint).toBe("http://localhost:8080");
  });

  it("resolves default path to ~/.pi/agent/searxng.json", () => {
    const defaultPath = getDefaultConfigPath();
    expect(defaultPath).toBe(path.join(os.homedir(), ".pi", "agent", "searxng.json"));
  });
});
