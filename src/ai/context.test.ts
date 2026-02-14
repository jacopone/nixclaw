import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConversationManager } from "./context.js";
import { StateStore } from "../core/state.js";
import { unlinkSync } from "node:fs";

const TEST_DB = "/tmp/nixclaw-context-test.db";

describe("ConversationManager", () => {
  let state: StateStore;
  let mgr: ConversationManager;

  beforeEach(() => {
    state = new StateStore(TEST_DB);
    mgr = new ConversationManager(state);
  });
  afterEach(() => {
    state.close();
    try {
      unlinkSync(TEST_DB);
    } catch {}
  });

  it("starts with empty history for new conversation", () => {
    expect(mgr.getMessages("conv-1")).toEqual([]);
  });

  it("appends user and assistant messages", () => {
    mgr.addUserMessage("conv-1", "hello");
    mgr.addAssistantMessage("conv-1", "hi there");
    const messages = mgr.getMessages("conv-1");
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: "user", content: "hello" });
    expect(messages[1]).toEqual({ role: "assistant", content: "hi there" });
  });

  it("isolates conversations", () => {
    mgr.addUserMessage("conv-1", "from conv 1");
    mgr.addUserMessage("conv-2", "from conv 2");
    expect(mgr.getMessages("conv-1")).toHaveLength(1);
    expect(mgr.getMessages("conv-2")).toHaveLength(1);
  });

  it("persists across instances", () => {
    mgr.addUserMessage("conv-1", "persisted");
    const mgr2 = new ConversationManager(state);
    expect(mgr2.getMessages("conv-1")).toHaveLength(1);
    expect(mgr2.getMessages("conv-1")[0].content).toBe("persisted");
  });

  it("truncates to max messages", () => {
    for (let i = 0; i < 60; i++) {
      mgr.addUserMessage("conv-1", `msg-${i}`);
    }
    const msgs = mgr.getMessages("conv-1");
    expect(msgs.length).toBeLessThanOrEqual(50);
  });
});
