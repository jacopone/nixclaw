import { Bot, InputFile } from "grammy";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { NixClawPlugin, PluginContext, NixClawMessage } from "../../core/types.js";
import { createSTT } from "../../voice/stt.js";
import { createTTS } from "../../voice/tts.js";
import type { STTProvider } from "../../voice/stt.js";
import type { TTSProvider } from "../../voice/tts.js";

interface TelegramConfig {
  botTokenFile: string;
  allowedUsers?: string[];
  voice?: {
    stt: { provider: "claude" | "whisper" };
    tts: { provider: "elevenlabs" | "piper" | "none"; apiKey?: string; voiceId?: string };
  };
}

export class TelegramChannel implements NixClawPlugin {
  name = "telegram";
  version = "0.1.0";
  private bot?: Bot;
  private cleanup?: () => void;
  private stt?: STTProvider;
  private tts?: TTSProvider;
  private ttsEnabled = false;
  /** Track which senders sent audio, so responses can include voice */
  private audioSenders = new Set<string>();

  isAllowedUser(userId: string, allowedUsers: string[]): boolean {
    if (allowedUsers.length === 0) return true;
    return allowedUsers.includes(userId);
  }

  async downloadFile(bot: Bot, fileId: string): Promise<Buffer> {
    const file = await bot.api.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async init(ctx: PluginContext): Promise<void> {
    const config = ctx.config as unknown as TelegramConfig;
    if (!config.botTokenFile) {
      ctx.logger.warn("No botTokenFile configured, skipping Telegram");
      return;
    }

    const token = readFileSync(config.botTokenFile, "utf-8").trim();
    const allowedUsers = config.allowedUsers ?? [];

    // Initialize voice providers if configured
    if (config.voice) {
      this.stt = createSTT({ provider: config.voice.stt.provider });
      this.tts = createTTS({
        provider: config.voice.tts.provider,
        apiKey: config.voice.tts.apiKey,
        voiceId: config.voice.tts.voiceId,
      });
      this.ttsEnabled = config.voice.tts.provider !== "none";
      ctx.logger.info(
        `Voice enabled: STT=${config.voice.stt.provider}, TTS=${config.voice.tts.provider}`,
      );
    }

    this.bot = new Bot(token);

    this.bot.on("message:text", async (gramCtx) => {
      const userId = String(gramCtx.from.id);
      if (!this.isAllowedUser(userId, allowedUsers)) {
        await gramCtx.reply("Access denied.");
        return;
      }

      const msg: NixClawMessage = {
        id: randomUUID(),
        channel: "telegram",
        sender: userId,
        text: gramCtx.message.text,
        timestamp: new Date(gramCtx.message.date * 1000),
      };
      ctx.eventBus.emit("message:incoming", msg);
    });

    this.bot.on("message:voice", async (gramCtx) => {
      const userId = String(gramCtx.from.id);
      if (!this.isAllowedUser(userId, allowedUsers)) {
        await gramCtx.reply("Access denied.");
        return;
      }

      if (!this.stt) {
        await gramCtx.reply("Voice messages are not enabled.");
        return;
      }

      try {
        const fileId = gramCtx.message.voice.file_id;
        const audioBuffer = await this.downloadFile(this.bot!, fileId);
        const transcription = await this.stt.transcribe(audioBuffer, "audio/ogg");

        this.audioSenders.add(userId);

        const msg: NixClawMessage = {
          id: randomUUID(),
          channel: "telegram",
          sender: userId,
          text: transcription,
          audio: audioBuffer,
          timestamp: new Date(gramCtx.message.date * 1000),
        };
        ctx.eventBus.emit("message:incoming", msg);
      } catch (err) {
        ctx.logger.error("Failed to process voice message:", err);
        await gramCtx.reply("Sorry, I could not process your voice message.");
      }
    });

    this.cleanup = ctx.eventBus.on("message:response", async (payload: unknown) => {
      const response = payload as { channel: string; sender: string; text: string };
      if (response.channel !== "telegram") return;

      const senderId = Number(response.sender);

      // Send voice reply if the sender sent audio and TTS is enabled
      if (this.ttsEnabled && this.tts && this.audioSenders.has(response.sender)) {
        this.audioSenders.delete(response.sender);
        try {
          const audioBuffer = await this.tts.synthesize(response.text);
          if (audioBuffer) {
            await this.bot!.api.sendVoice(senderId, new InputFile(audioBuffer, "reply.ogg"));
          }
        } catch (err) {
          ctx.logger.error("Failed to send voice reply:", err);
        }
      }

      // Always send text as well (fallback/companion)
      try {
        await this.bot!.api.sendMessage(senderId, response.text, {
          parse_mode: "Markdown",
        });
      } catch {
        try {
          await this.bot!.api.sendMessage(senderId, response.text);
        } catch (fallbackErr) {
          ctx.logger.error("Failed to send Telegram message:", fallbackErr);
        }
      }
    });

    this.bot.start({ onStart: () => ctx.logger.info("Telegram bot started") });
  }

  async shutdown(): Promise<void> {
    this.cleanup?.();
    this.bot?.stop();
  }
}
