import type Anthropic from "@anthropic-ai/sdk";
import type { StateStore } from "../core/state.js";

const NAMESPACE = "conversations";
const MAX_MESSAGES = 50;

export class ConversationManager {
  constructor(private state: StateStore) {}

  getMessages(conversationId: string): Anthropic.MessageParam[] {
    const raw = this.state.getJSON<Anthropic.MessageParam[]>(
      NAMESPACE,
      conversationId,
    );
    return raw ?? [];
  }

  addUserMessage(conversationId: string, text: string): void {
    this.append(conversationId, { role: "user", content: text });
  }

  addAssistantMessage(conversationId: string, text: string): void {
    this.append(conversationId, { role: "assistant", content: text });
  }

  private append(
    conversationId: string,
    message: Anthropic.MessageParam,
  ): void {
    const messages = this.getMessages(conversationId);
    messages.push(message);
    const trimmed = messages.slice(-MAX_MESSAGES);
    this.state.setJSON(NAMESPACE, conversationId, trimmed);
  }
}
