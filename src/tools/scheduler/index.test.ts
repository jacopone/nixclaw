import { describe, it, expect, vi } from "vitest";
import { SchedulerPlugin } from "./index.js";
import { EventBus } from "../../core/event-bus.js";
import { StateStore } from "../../core/state.js";
import type { PluginContext, Tool } from "../../core/types.js";
import { unlinkSync } from "node:fs";

const TEST_DB = "/tmp/nixclaw-scheduler-test.db";

describe("SchedulerPlugin", () => {
  it("implements NixClawPlugin interface", () => {
    const plugin = new SchedulerPlugin();
    expect(plugin.name).toBe("scheduler");
  });

  it("registers schedule tool on init", async () => {
    const plugin = new SchedulerPlugin();
    const bus = new EventBus();
    const state = new StateStore(TEST_DB);
    const tools: Tool[] = [];

    const ctx: PluginContext = {
      eventBus: bus,
      registerTool: (t) => tools.push(t),
      state,
      config: {},
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };

    await plugin.init(ctx);

    expect(tools.length).toBeGreaterThanOrEqual(1);
    const names = tools.map((t) => t.name);
    expect(names).toContain("nixclaw_schedule_task");

    await plugin.shutdown();
    state.close();
    try { unlinkSync(TEST_DB); } catch {}
  });
});
