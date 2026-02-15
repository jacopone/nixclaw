import { randomUUID } from "node:crypto";
import type { StateStore } from "./state.js";

export interface ApprovalRequest {
  id: string;
  tool: string;
  input: string;
  session: string;
  requester: string;
  status: "pending" | "allow" | "deny" | "expired";
  createdAt: number;
}

const NAMESPACE = "approvals";

export class ApprovalStore {
  constructor(private state: StateStore) {}

  requestApproval(req: Omit<ApprovalRequest, "id" | "status" | "createdAt">): string {
    const id = randomUUID().slice(0, 8);
    const approval: ApprovalRequest = {
      ...req,
      id,
      status: "pending",
      createdAt: Date.now(),
    };
    this.state.setJSON(NAMESPACE, id, approval);
    // Maintain pending index
    const index = this.state.getJSON<string[]>(NAMESPACE, "_pending_index") ?? [];
    index.push(id);
    this.state.setJSON(NAMESPACE, "_pending_index", index);
    return id;
  }

  get(id: string): ApprovalRequest | undefined {
    return this.state.getJSON<ApprovalRequest>(NAMESPACE, id);
  }

  decide(id: string, decision: "allow" | "deny"): void {
    const req = this.get(id);
    if (!req || req.status !== "pending") return;
    req.status = decision;
    this.state.setJSON(NAMESPACE, id, req);
    this.removeFromPendingIndex(id);
  }

  listPending(): ApprovalRequest[] {
    const index = this.state.getJSON<string[]>(NAMESPACE, "_pending_index") ?? [];
    return index
      .map((id) => this.get(id))
      .filter((r): r is ApprovalRequest => r !== undefined && r.status === "pending");
  }

  expireOlderThan(maxAgeMs: number): void {
    const index = this.state.getJSON<string[]>(NAMESPACE, "_pending_index") ?? [];
    const now = Date.now();
    const expiredIds: string[] = [];
    for (const id of index) {
      const req = this.get(id);
      if (req && req.status === "pending" && now - req.createdAt >= maxAgeMs) {
        req.status = "expired";
        this.state.setJSON(NAMESPACE, id, req);
        expiredIds.push(id);
      }
    }
    if (expiredIds.length > 0) {
      const cleaned = index.filter((id) => !expiredIds.includes(id));
      this.state.setJSON(NAMESPACE, "_pending_index", cleaned);
    }
  }

  private removeFromPendingIndex(id: string): void {
    const index = this.state.getJSON<string[]>(NAMESPACE, "_pending_index") ?? [];
    const cleaned = index.filter((i) => i !== id);
    this.state.setJSON(NAMESPACE, "_pending_index", cleaned);
  }
}
