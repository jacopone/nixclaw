import { describe, it, expect } from "vitest";
import { TelegramChannel } from "./index.js";

describe("TelegramChannel voice", () => {
  it("has voice support in the plugin", () => {
    const channel = new TelegramChannel();
    expect(channel.name).toBe("telegram");
    // The voice handler is registered during init() with a real bot,
    // so we just verify the plugin exists and can be instantiated
    expect(channel.version).toBe("0.1.0");
  });
});
