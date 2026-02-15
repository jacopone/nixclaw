import { describe, it, expect } from "vitest";
import { safeExec, isCommandAllowed, ALLOWED_COMMANDS, BLOCKED_PATTERNS } from "./safe-exec.js";

describe("safe-exec", () => {
  describe("isCommandAllowed", () => {
    it("allows whitelisted commands", () => {
      expect(isCommandAllowed("ps", ["aux"])).toBe(true);
      expect(isCommandAllowed("free", ["-h"])).toBe(true);
      expect(isCommandAllowed("hostname", [])).toBe(true);
    });

    it("blocks non-whitelisted commands", () => {
      expect(isCommandAllowed("rm", ["-rf", "/"])).toBe(false);
      expect(isCommandAllowed("dd", ["if=/dev/zero"])).toBe(false);
      expect(isCommandAllowed("sudo", ["anything"])).toBe(false);
    });

    it("blocks dangerous argument patterns even in allowed commands", () => {
      expect(isCommandAllowed("ls", ["; rm -rf /"])).toBe(false);
      expect(isCommandAllowed("cat", ["$(whoami)"])).toBe(false);
      expect(isCommandAllowed("find", ["-exec", "rm"])).toBe(false);
    });
  });

  describe("safeExec", () => {
    it("executes allowed commands", async () => {
      const result = await safeExec("hostname", []);
      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    });

    it("rejects blocked commands", async () => {
      const result = await safeExec("rm", ["-rf", "/"]);
      expect(result).toContain("BLOCKED");
    });

    it("truncates output exceeding maxBytes", async () => {
      const result = await safeExec("ps", ["aux"], { maxBytes: 100 });
      expect(result.length).toBeLessThanOrEqual(150); // 100 + truncation notice
    });
  });
});
