import { describe, it, expect } from "vitest";
import { createTTS } from "./tts.js";

describe("TTS", () => {
  it("creates an elevenlabs TTS provider", () => {
    const tts = createTTS({ provider: "elevenlabs", apiKey: "test", voiceId: "test" });
    expect(tts).toBeDefined();
    expect(tts.synthesize).toBeInstanceOf(Function);
  });

  it("creates a none TTS provider that returns null", async () => {
    const tts = createTTS({ provider: "none" });
    const result = await tts.synthesize("hello");
    expect(result).toBeNull();
  });
});
