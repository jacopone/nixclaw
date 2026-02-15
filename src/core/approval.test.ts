import { describe, it, expect, afterEach } from "vitest";
import { ApprovalStore } from "./approval.js";
import { StateStore } from "./state.js";
import { unlinkSync } from "node:fs";

const TEST_DB = "/tmp/nixclaw-approval-test.db";

describe("ApprovalStore", () => {
  let state: StateStore;
  let approvals: ApprovalStore;

  afterEach(() => {
    try { state?.close(); } catch {}
    try { unlinkSync(TEST_DB); } catch {}
  });

  it("creates a pending approval request", () => {
    state = new StateStore(TEST_DB);
    approvals = new ApprovalStore(state);

    const id = approvals.requestApproval({
      tool: "Bash",
      input: "git push origin main",
      session: "claude-session-1",
      requester: "claude-code",
    });

    const req = approvals.get(id);
    expect(req).toBeDefined();
    expect(req!.status).toBe("pending");
    expect(req!.tool).toBe("Bash");
  });

  it("approves a pending request", () => {
    state = new StateStore(TEST_DB);
    approvals = new ApprovalStore(state);

    const id = approvals.requestApproval({
      tool: "Bash",
      input: "npm test",
      session: "s1",
      requester: "claude-code",
    });

    approvals.decide(id, "allow");
    expect(approvals.get(id)!.status).toBe("allow");
  });

  it("denies a pending request", () => {
    state = new StateStore(TEST_DB);
    approvals = new ApprovalStore(state);

    const id = approvals.requestApproval({
      tool: "Write",
      input: "/etc/hosts",
      session: "s1",
      requester: "claude-code",
    });

    approvals.decide(id, "deny");
    expect(approvals.get(id)!.status).toBe("deny");
  });

  it("lists pending approvals", () => {
    state = new StateStore(TEST_DB);
    approvals = new ApprovalStore(state);

    approvals.requestApproval({ tool: "A", input: "1", session: "s1", requester: "x" });
    approvals.requestApproval({ tool: "B", input: "2", session: "s1", requester: "x" });

    const pending = approvals.listPending();
    expect(pending).toHaveLength(2);
  });

  it("times out old pending requests", () => {
    state = new StateStore(TEST_DB);
    approvals = new ApprovalStore(state);

    const id = approvals.requestApproval({
      tool: "Bash",
      input: "test",
      session: "s1",
      requester: "x",
    });

    approvals.expireOlderThan(0);
    expect(approvals.get(id)!.status).toBe("expired");
  });
});
