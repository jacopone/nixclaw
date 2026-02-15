import { Bot, InputFile } from "grammy";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { NixClawPlugin, PluginContext, NixClawMessage } from "../../core/types.js";
import { createSTT } from "../../voice/stt.js";
import { createTTS } from "../../voice/tts.js";
import type { STTProvider } from "../../voice/stt.js";
import type { TTSProvider } from "../../voice/tts.js";
import { parseApprovalCommand } from "./approval.js";
import { PairingManager } from "./pairing.js";

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
  private cleanups: Array<() => void> = [];
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
    const pairing = new PairingManager(allowedUsers);

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
      const text = gramCtx.message.text;

      // Check if user is authorized via pairing
      if (!pairing.isAuthorized(userId)) {
        // Check if this is a pairing code attempt (6 digits)
        const codeMatch = text.match(/^\d{6}$/);
        if (codeMatch) {
          const success = pairing.completePairing(userId, text);
          if (success) {
            await gramCtx.reply("✓ Pairing successful! You now have access to NixClaw.");
          } else {
            await gramCtx.reply("✗ Invalid pairing code. Try again.");
          }
          return;
        }

        // Unknown user — generate pairing code and log it
        const code = pairing.requestPairing(userId);
        ctx.logger.info(`Pairing code for user ${userId}: ${code}`);
        await gramCtx.reply("🔐 Access requires pairing. A 6-digit code has been generated — check the NixClaw server logs or ask the admin.");
        return;
      }

      // Check for approval commands
      const approvalCmd = parseApprovalCommand(text);
      if (approvalCmd) {
        ctx.eventBus.emit("approval:decide", approvalCmd);
        await gramCtx.reply(`✓ Sent ${approvalCmd.decision} for request ${approvalCmd.id}`);
        return;
      }

      const msg: NixClawMessage = {
        id: randomUUID(),
        channel: "telegram",
        sender: userId,
        text,
        timestamp: new Date(gramCtx.message.date * 1000),
      };
      ctx.eventBus.emit("message:incoming", msg);
    });

    this.bot.on("message:voice", async (gramCtx) => {
      const userId = String(gramCtx.from.id);
      if (!pairing.isAuthorized(userId)) {
        await gramCtx.reply("Access denied. Send a text message first to start pairing.");
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

    this.cleanups.push(ctx.eventBus.on("message:response", async (payload: unknown) => {
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
    }));

    // Listen for approval requests and notify via Telegram
    const approvalCleanup = ctx.eventBus.on("approval:request", async (payload: unknown) => {
      const req = payload as { id: string; tool: string; input: string; session: string };
      if (!req) return;
      const notifyUser = allowedUsers[0];
      if (!notifyUser || !this.bot) return;

      const message = `🔐 Approval Request [${req.id}]\n\nTool: ${req.tool}\nInput: ${req.input}\nSession: ${req.session}\n\nReply:\n/allow ${req.id}\n/deny ${req.id}`;
      try {
        await this.bot.api.sendMessage(Number(notifyUser), message);
      } catch (err) {
        ctx.logger.error("Failed to send approval notification:", err);
      }
    });
    this.cleanups.push(approvalCleanup);

    ctx.eventBus.on("approval:decide", async (payload: unknown) => {
      const cmd = payload as { decision: "allow" | "deny"; id: string };
      // POST to local WebUI approval endpoint
      try {
        await fetch(`http://localhost:${(ctx.config as any).webuiPort ?? 3344}/api/approve/${cmd.id}/decide`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision: cmd.decision }),
        });
      } catch (err) {
        ctx.logger.error("Failed to submit approval decision:", err);
      }
    });

    this.bot.start({ onStart: () => ctx.logger.info("Telegram bot started") });
  }

  async shutdown(): Promise<void> {
    this.cleanups.forEach(fn => fn());
    this.bot?.stop();
  }
}
