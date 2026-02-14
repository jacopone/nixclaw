import Anthropic from "@anthropic-ai/sdk";

interface STTConfig {
  provider: "claude" | "whisper";
}

export interface STTProvider {
  transcribe(audioBuffer: Buffer, mimeType: string): Promise<string>;
}

class ClaudeSTT implements STTProvider {
  async transcribe(audioBuffer: Buffer, mimeType: string): Promise<string> {
    const client = new Anthropic();

    // The Anthropic API supports audio in document blocks at runtime,
    // but the SDK types only define PDF/text sources for DocumentBlockParam.
    // We use a type assertion to send base64-encoded audio for transcription.
    const audioBlock = {
      type: "document" as const,
      source: {
        type: "base64" as const,
        media_type: mimeType,
        data: audioBuffer.toString("base64"),
      },
    } as Anthropic.DocumentBlockParam;

    const response = await client.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Transcribe this audio message exactly. Return only the transcription, nothing else.",
            },
            audioBlock,
          ],
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return text;
  }
}

export function createSTT(config: STTConfig): STTProvider {
  switch (config.provider) {
    case "claude":
      return new ClaudeSTT();
    case "whisper":
      throw new Error("Whisper STT not yet implemented");
    default:
      return new ClaudeSTT();
  }
}
