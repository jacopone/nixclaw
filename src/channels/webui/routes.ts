import type { FastifyInstance } from "fastify";
import type { EventBus } from "../../core/event-bus.js";
import type { StateStore } from "../../core/state.js";
import { randomUUID } from "node:crypto";
import type { NixClawMessage } from "../../core/types.js";

export function registerRoutes(
  app: FastifyInstance,
  eventBus: EventBus,
  state: StateStore,
): void {
  app.get("/api/health", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

  app.post<{ Body: { text: string } }>("/api/chat", async (req) => {
    const msg: NixClawMessage = {
      id: randomUUID(),
      channel: "webui",
      sender: "webui-user",
      text: req.body.text,
      timestamp: new Date(),
    };
    eventBus.emit("message:incoming", msg);
    return { id: msg.id, status: "processing" };
  });

  app.get("/api/stream", async (req, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const off = eventBus.on("message:response", (payload: unknown) => {
      const response = payload as { channel: string; text: string };
      if (response.channel === "webui") {
        reply.raw.write(`data: ${JSON.stringify(response)}\n\n`);
      }
    });

    req.raw.on("close", () => off());
  });

  app.get("/", async (req, reply) => {
    reply.type("text/html").send(DASHBOARD_HTML);
  });
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>NixClaw</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: monospace; background: #1a1a2e; color: #e0e0e0; height: 100vh; display: flex; flex-direction: column; }
    #header { padding: 12px 16px; background: #16213e; border-bottom: 1px solid #0f3460; }
    #header h1 { font-size: 16px; color: #e94560; }
    #messages { flex: 1; overflow-y: auto; padding: 16px; }
    .msg { margin-bottom: 12px; padding: 8px 12px; border-radius: 4px; max-width: 80%; }
    .msg.user { background: #0f3460; margin-left: auto; }
    .msg.agent { background: #16213e; }
    #input-area { padding: 12px 16px; background: #16213e; border-top: 1px solid #0f3460; display: flex; gap: 8px; }
    #input { flex: 1; background: #1a1a2e; border: 1px solid #0f3460; color: #e0e0e0; padding: 8px; border-radius: 4px; font-family: monospace; }
    #send { background: #e94560; border: none; color: white; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
  </style>
</head>
<body>
  <div id="header"><h1>NixClaw</h1></div>
  <div id="messages"></div>
  <div id="input-area">
    <input id="input" placeholder="Type a message..." autofocus>
    <button id="send">Send</button>
  </div>
  <script>
    const msgs = document.getElementById('messages');
    const input = document.getElementById('input');
    const send = document.getElementById('send');
    function addMsg(text, cls) {
      const div = document.createElement('div');
      div.className = 'msg ' + cls;
      div.textContent = text;
      msgs.appendChild(div);
      msgs.scrollTop = msgs.scrollHeight;
    }
    const es = new EventSource('/api/stream');
    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      addMsg(data.text, 'agent');
    };
    async function sendMsg() {
      const text = input.value.trim();
      if (!text) return;
      addMsg(text, 'user');
      input.value = '';
      await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    }
    send.onclick = sendMsg;
    input.onkeydown = (e) => { if (e.key === 'Enter') sendMsg(); };
  </script>
</body>
</html>`;
