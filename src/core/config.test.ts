import { describe, it, expect, afterEach } from "vitest";
import { loadConfig } from "./config.js";

describe("Config", () => {
  afterEach(() => {
    delete process.env.NIXCLAW_CONFIG;
  });

  it("loads config from NIXCLAW_CONFIG env var", () => {
    process.env.NIXCLAW_CONFIG = JSON.stringify({
      ai: { provider: "claude", model: "claude-opus-4-20250514", apiKeyFile: "/tmp/key" },
    });
    const cfg = loadConfig();
    expect(cfg.ai.model).toBe("claude-opus-4-20250514");
    expect(cfg.ai.apiKeyFile).toBe("/tmp/key");
  });

  it("falls back to defaults when env var is not set", () => {
    const cfg = loadConfig();
    expect(cfg.ai.provider).toBe("claude");
    expect(cfg.ai.model).toBe("claude-sonnet-4-5-20250929");
    expect(cfg.channels.telegram.enable).toBe(false);
    expect(cfg.channels.webui.port).toBe(3333);
    expect(cfg.stateDir).toContain(".local/share/nixclaw");
  });
});
