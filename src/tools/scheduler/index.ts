import { CronJob } from "cron";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { NixClawPlugin, PluginContext, NixClawMessage } from "../../core/types.js";

interface ScheduledTask {
  id: string;
  cronExpression: string;
  message: string;
  channel: string;
  job: CronJob;
}

export class SchedulerPlugin implements NixClawPlugin {
  name = "scheduler";
  version = "0.1.0";
  private tasks: ScheduledTask[] = [];

  async init(ctx: PluginContext): Promise<void> {
    const { eventBus, logger } = ctx;

    ctx.registerTool({
      name: "nixclaw_schedule_task",
      description:
        "Schedule a recurring task using a cron expression. The message will be sent to the agent on each trigger.",
      inputSchema: z.object({
        cronExpression: z
          .string()
          .describe("Cron expression (e.g. '0 9 * * *' for daily at 9am)"),
        message: z
          .string()
          .describe("Message to send to the agent on each trigger"),
        channel: z
          .string()
          .optional()
          .describe(
            "Channel to attribute the message to (default: scheduler)"
          ),
      }),
      run: async (input) => {
        const { cronExpression, message, channel } = input as {
          cronExpression: string;
          message: string;
          channel?: string;
        };
        const id = randomUUID().slice(0, 8);
        const targetChannel = channel ?? "scheduler";

        const job = new CronJob(cronExpression, () => {
          const msg: NixClawMessage = {
            id: randomUUID(),
            channel: targetChannel,
            sender: "scheduler",
            text: message,
            timestamp: new Date(),
          };
          eventBus.emit("message:incoming", msg);
          logger.info(`Scheduler triggered: ${id} — "${message}"`);
        });
        job.start();

        this.tasks.push({
          id,
          cronExpression,
          message,
          channel: targetChannel,
          job,
        });
        return `Scheduled task ${id}: "${message}" with cron "${cronExpression}"`;
      },
    });

    ctx.registerTool({
      name: "nixclaw_list_scheduled",
      description: "List all currently scheduled tasks",
      inputSchema: z.object({}),
      run: async () => {
        if (this.tasks.length === 0) return "No scheduled tasks.";
        return this.tasks
          .map(
            (t) =>
              `${t.id}: "${t.message}" [${t.cronExpression}] (channel: ${t.channel})`
          )
          .join("\n");
      },
    });

    logger.info("Scheduler plugin registered");
  }

  async shutdown(): Promise<void> {
    for (const task of this.tasks) {
      await task.job.stop();
    }
    this.tasks = [];
  }
}
