export function parseApprovalCommand(text: string): { decision: "allow" | "deny"; id: string } | null {
  const match = text.match(/^\/(allow|deny)\s+(\S+)/);
  if (!match) return null;
  return { decision: match[1] as "allow" | "deny", id: match[2] };
}
