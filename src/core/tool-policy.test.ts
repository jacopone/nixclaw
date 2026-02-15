import { describe, it, expect } from "vitest";
import { ToolPolicy, evaluatePolicy } from "./tool-policy.js";

describe("ToolPolicy", () => {
  it("allows tools not mentioned in any policy", () => {
    const policies: ToolPolicy[] = [];
    expect(evaluatePolicy(policies, "nixclaw_processes", "telegram", "user1")).toBe("allow");
  });

  it("blocks tools in deny list", () => {
    const policies: ToolPolicy[] = [
      { tool: "nixclaw_query", effect: "deny", channels: ["telegram"] },
    ];
    expect(evaluatePolicy(policies, "nixclaw_query", "telegram", "user1")).toBe("deny");
    expect(evaluatePolicy(policies, "nixclaw_query", "webui", "user1")).toBe("allow");
  });

  it("requires approval for tools marked as such", () => {
    const policies: ToolPolicy[] = [
      { tool: "nixclaw_query", effect: "approve", channels: ["telegram"] },
    ];
    expect(evaluatePolicy(policies, "nixclaw_query", "telegram", "user1")).toBe("approve");
  });

  it("supports wildcard tool matching", () => {
    const policies: ToolPolicy[] = [
      { tool: "*", effect: "deny", channels: ["telegram"], users: ["unknown-user"] },
    ];
    expect(evaluatePolicy(policies, "nixclaw_anything", "telegram", "unknown-user")).toBe("deny");
    expect(evaluatePolicy(policies, "nixclaw_anything", "telegram", "owner")).toBe("allow");
  });

  it("first matching policy wins", () => {
    const policies: ToolPolicy[] = [
      { tool: "nixclaw_query", effect: "allow", users: ["owner"] },
      { tool: "nixclaw_query", effect: "deny" },
    ];
    expect(evaluatePolicy(policies, "nixclaw_query", "terminal", "owner")).toBe("allow");
    expect(evaluatePolicy(policies, "nixclaw_query", "terminal", "someone-else")).toBe("deny");
  });
});
