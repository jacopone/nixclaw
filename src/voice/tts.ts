interface TTSConfig {
  provider: "elevenlabs" | "piper" | "none";
  apiKey?: string;
  voiceId?: string;
}

export interface TTSProvider {
  synthesize(text: string): Promise<Buffer | null>;
}

class ElevenLabsTTS implements TTSProvider {
  constructor(
    private apiKey: string,
    private voiceId: string,
  ) {}

  async synthesize(text: string): Promise<Buffer | null> {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2_5",
        }),
      },
    );
    if (!response.ok)
      throw new Error(`ElevenLabs API error: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
}

class NoneTTS implements TTSProvider {
  async synthesize(): Promise<null> {
    return null;
  }
}

export function createTTS(config: TTSConfig): TTSProvider {
  switch (config.provider) {
    case "elevenlabs":
      return new ElevenLabsTTS(config.apiKey!, config.voiceId!);
    case "piper":
      throw new Error("Piper TTS not yet implemented");
    case "none":
    default:
      return new NoneTTS();
  }
}
