import { randomInt } from "node:crypto";

export class PairingManager {
  private pendingCodes = new Map<string, string>();
  private pairedUsers = new Set<string>();

  constructor(private allowedUsers: string[]) {
    for (const u of allowedUsers) this.pairedUsers.add(u);
  }

  isAuthorized(userId: string): boolean {
    if (this.allowedUsers.length === 0) return true;
    return this.pairedUsers.has(userId);
  }

  requestPairing(userId: string): string {
    const code = String(randomInt(100000, 999999));
    this.pendingCodes.set(userId, code);
    return code;
  }

  completePairing(userId: string, code: string): boolean {
    const expected = this.pendingCodes.get(userId);
    if (!expected || expected !== code) return false;
    this.pairedUsers.add(userId);
    this.pendingCodes.delete(userId);
    return true;
  }
}
