import { loadConfig } from "./core/config.js";
import { EventBus } from "./core/event-bus.js";
import { StateStore } from "./core/state.js";
import { PluginHost } from "./core/plugin-host.js";
import { Agent } from "./core/agent.js";
import { TerminalChannel } from "./channels/terminal/index.js";
import { TelegramChannel } from "./channels/telegram/index.js";
import { NixOSToolsPlugin } from "./tools/nixos/index.js";
import { mkdirSync } from "node:fs";

async function main() {
  console.log("NixClaw v0.1.0 — starting...\n");

  const config = loadConfig();

  mkdirSync(config.stateDir, { recursive: true });

  const eventBus = new EventBus();
  const state = new StateStore(`${config.stateDir}/nixclaw.db`);
  const pluginHost = new PluginHost(eventBus, state);

  await pluginHost.register(new TerminalChannel(), {});

  if (config.channels.telegram.enable) {
    await pluginHost.register(new TelegramChannel(), config.channels.telegram as unknown as Record<string, unknown>);
  }

  if (config.tools.nixos.enable) {
    await pluginHost.register(new NixOSToolsPlugin(), config.tools.nixos as unknown as Record<string, unknown>);
  }

  await pluginHost.initAll();

  const _agent = new Agent(config, eventBus, state, pluginHost);

  const shutdown = async () => {
    console.log("\nShutting down...");
    await pluginHost.shutdownAll();
    state.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
