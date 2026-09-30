import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { handleSearxngCommand } from "../src/commands.js";

describe("SearXNG Slash Commands", () => {
  let tmpDir: string;
  let testConfigPath: string;
  let mockUi: any;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-commands-test-"));
    testConfigPath = path.join(tmpDir, "searxng.json");
    fs.writeFileSync(
      testConfigPath,
      JSON.stringify({
        endpoint: "http://localhost:8080",
        apiKey: "",
        categories: "general",
        defaultEngines: "",
        timeoutMs: 10000,
      }),
      "utf-8"
    );

    mockUi = {
      select: vi.fn(),
      input: vi.fn(),
      confirm: vi.fn().mockResolvedValue(true),
      notify: vi.fn(),
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("handles unknown or empty arguments by displaying usage help", async () => {
    await handleSearxngCommand("", { ui: mockUi }, testConfigPath);

    expect(mockUi.notify).toHaveBeenCalledTimes(1);
    expect(mockUi.notify).toHaveBeenCalledWith(
      expect.stringContaining("/searxng config"),
      "info"
    );
  });

  it("executes /searxng status and reports healthy state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ results: [] }),
      })
    );

    await handleSearxngCommand("status", { ui: mockUi }, testConfigPath);

    expect(mockUi.notify).toHaveBeenCalledWith(
      expect.stringContaining("healthy"),
      "info"
    );
    expect(mockUi.confirm).toHaveBeenCalledWith(
      "SearXNG Health Status",
      expect.stringContaining("Healthy (HTTP 200)"),
      expect.any(Object)
    );
  });

  it("executes /searxng status and reports unhealthy state with troubleshooting hint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Connection refused"))
    );

    await handleSearxngCommand("status", { ui: mockUi }, testConfigPath);

    expect(mockUi.notify).toHaveBeenCalledWith(
      expect.stringContaining("Failed to connect"),
      "error"
    );
    expect(mockUi.confirm).toHaveBeenCalledWith(
      "SearXNG Health Status",
      expect.stringContaining("Unhealthy"),
      expect.any(Object)
    );
  });

  it("executes /searxng config and allows updating endpoint then saving", async () => {
    // 1st select: "1. Endpoint"
    // 2nd select: "Save & Exit"
    mockUi.select
      .mockResolvedValueOnce("1. Endpoint: http://localhost:8080")
      .mockResolvedValueOnce("Save & Exit");

    mockUi.input.mockResolvedValueOnce("https://custom-searx.internal");

    await handleSearxngCommand("config", { ui: mockUi }, testConfigPath);

    expect(mockUi.input).toHaveBeenCalledWith(
      "Update Endpoint",
      "http://localhost:8080"
    );
    expect(mockUi.notify).toHaveBeenCalledWith(
      expect.stringContaining("Configuration saved"),
      "info"
    );

    const saved = JSON.parse(fs.readFileSync(testConfigPath, "utf-8"));
    expect(saved.endpoint).toBe("https://custom-searx.internal");
  });

  it("executes /searxng config and runs Test Connection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ results: [] }),
      })
    );

    // 1st select: "Test Connection"
    // 2nd select: "Cancel"
    mockUi.select
      .mockResolvedValueOnce("Test Connection")
      .mockResolvedValueOnce("Cancel");

    await handleSearxngCommand("config", { ui: mockUi }, testConfigPath);

    expect(mockUi.notify).toHaveBeenCalledWith(
      expect.stringContaining("healthy"),
      "info"
    );
  });

  it("executes /searxng config and exits without saving when Cancel is selected", async () => {
    mockUi.select.mockResolvedValueOnce("Cancel");

    await handleSearxngCommand("config", { ui: mockUi }, testConfigPath);

    expect(mockUi.notify).toHaveBeenCalledWith("Configuration unchanged", "info");
    const saved = JSON.parse(fs.readFileSync(testConfigPath, "utf-8"));
    expect(saved.endpoint).toBe("http://localhost:8080");
  });
});
