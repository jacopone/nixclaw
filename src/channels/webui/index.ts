import Fastify, { type FastifyInstance } from "fastify";
import type { NixClawPlugin, PluginContext } from "../../core/types.js";
import { registerRoutes } from "./routes.js";

interface WebUIConfig {
  port: number;
  host?: string;
}

export class WebUIChannel implements NixClawPlugin {
  name = "webui";
  version = "0.1.0";
  private app?: FastifyInstance;

  async init(ctx: PluginContext): Promise<void> {
    const config = ctx.config as unknown as WebUIConfig;
    const port = config.port ?? 3333;
    const host = config.host ?? "127.0.0.1";

    this.app = Fastify();
    registerRoutes(this.app, ctx.eventBus, ctx.state);

    await this.app.listen({ port, host });
    ctx.logger.info(`Web UI listening on http://${host}:${port}`);
  }

  async shutdown(): Promise<void> {
    await this.app?.close();
  }
}
