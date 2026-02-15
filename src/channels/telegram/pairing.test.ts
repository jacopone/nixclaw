import { describe, it, expect } from "vitest";
import { PairingManager } from "./pairing.js";

describe("PairingManager", () => {
  it("generates a pairing code for unknown users", () => {
    const pm = new PairingManager(["owner-123"]);
    const code = pm.requestPairing("unknown-456");
    expect(code).toMatch(/^\d{6}$/);
  });

  it("allows known users without pairing", () => {
    const pm = new PairingManager(["owner-123"]);
    expect(pm.isAuthorized("owner-123")).toBe(true);
  });

  it("blocks unknown users until pairing complete", () => {
    const pm = new PairingManager(["owner-123"]);
    expect(pm.isAuthorized("unknown-456")).toBe(false);
  });

  it("authorizes after correct pairing code", () => {
    const pm = new PairingManager(["owner-123"]);
    const code = pm.requestPairing("new-user");
    const success = pm.completePairing("new-user", code);
    expect(success).toBe(true);
    expect(pm.isAuthorized("new-user")).toBe(true);
  });

  it("rejects wrong pairing code", () => {
    const pm = new PairingManager(["owner-123"]);
    pm.requestPairing("new-user");
    const success = pm.completePairing("new-user", "000000");
    expect(success).toBe(false);
    expect(pm.isAuthorized("new-user")).toBe(false);
  });

  it("allows all users when allowedUsers is empty", () => {
    const pm = new PairingManager([]);
    expect(pm.isAuthorized("anyone")).toBe(true);
  });
});
