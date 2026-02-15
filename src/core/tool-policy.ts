export interface ToolPolicy {
  tool: string; // tool name or "*" for wildcard
  effect: "allow" | "deny" | "approve";
  channels?: string[]; // if set, only applies to these channels
  users?: string[]; // if set, only applies to these users
}

export type PolicyDecision = "allow" | "deny" | "approve";

export function evaluatePolicy(
  policies: ToolPolicy[],
  toolName: string,
  channel: string,
  sender: string,
): PolicyDecision {
  for (const policy of policies) {
    if (policy.tool !== "*" && policy.tool !== toolName) continue;
    if (policy.channels && !policy.channels.includes(channel)) continue;
    if (policy.users && !policy.users.includes(sender)) continue;
    return policy.effect;
  }
  return "allow";
}
