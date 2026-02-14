import { describe, it, expect } from "vitest";
import { createSTT } from "./stt.js";

describe("STT", () => {
  it("creates a claude STT provider", () => {
    const stt = createSTT({ provider: "claude" });
    expect(stt).toBeDefined();
    expect(stt.transcribe).toBeInstanceOf(Function);
  });
});
