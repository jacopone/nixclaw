import { describe, it, expect, vi, afterEach } from "vitest";
import { ObservePlugin } from "./index.js";
import { EventBus } from "../../core/event-bus.js";
import { StateStore } from "../../core/state.js";
import type { PluginContext, Tool } from "../../core/types.js";
import { unlinkSync } from "node:fs";

const TEST_DB = "/tmp/nixclaw-observe-test.db";

describe("ObservePlugin", () => {
  let state: StateStore;

  afterEach(() => {
    try { state?.close(); } catch {}
    try { unlinkSync(TEST_DB); } catch {}
  });

  it("registers all observation tools", async () => {
    const plugin = new ObservePlugin();
    const bus = new EventBus();
    state = new StateStore(TEST_DB);
    const tools: Tool[] = [];

    const ctx: PluginContext = {
      eventBus: bus,
      registerTool: (t) => tools.push(t),
      state,
      config: { allowedReadPaths: ["/tmp", "/home"] },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };

    await plugin.init(ctx);

    const names = tools.map((t) => t.name);
    expect(names).toContain("nixclaw_processes");
    expect(names).toContain("nixclaw_resources");
    expect(names).toContain("nixclaw_journal");
    expect(names).toContain("nixclaw_network");
    expect(names).toContain("nixclaw_read_file");
    expect(names).toContain("nixclaw_query");
  });

  it("nixclaw_processes returns process info", async () => {
    const plugin = new ObservePlugin();
    const bus = new EventBus();
    state = new StateStore(TEST_DB);
    const tools: Tool[] = [];

    const ctx: PluginContext = {
      eventBus: bus,
      registerTool: (t) => tools.push(t),
      state,
      config: {},
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };

    await plugin.init(ctx);
    const processTool = tools.find((t) => t.name === "nixclaw_processes")!;
    const result = await processTool.run({ query: "node" });
    expect(typeof result).toBe("string");
  });
});
