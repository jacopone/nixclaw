import { z } from "zod";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { NixClawPlugin, PluginContext } from "../../core/types.js";
import { safeExec } from "./safe-exec.js";

interface ObserveConfig {
  allowedReadPaths?: string[];
}

export class ObservePlugin implements NixClawPlugin {
  name = "observe";
  version = "0.1.0";

  async init(ctx: PluginContext): Promise<void> {
    const config = ctx.config as unknown as ObserveConfig;
    const allowedPaths = config.allowedReadPaths ?? ["/tmp", "/var/log", "/etc/nixos"];

    ctx.registerTool({
      name: "nixclaw_processes",
      description:
        "Search for running processes by name. Returns matching process info (PID, CPU, MEM, command).",
      inputSchema: z.object({
        query: z.string().describe("Process name or pattern to search for (e.g. 'chrome', 'claude', 'node')"),
      }),
      run: async (input) => {
        const { query } = input as { query: string };
        const [pgrep, ps] = await Promise.all([
          safeExec("pgrep", ["-af", query]),
          safeExec("ps", ["aux", "--sort=-%mem"]),
        ]);
        const header = ps.split("\n")[0];
        const matching = ps.split("\n").filter((line) =>
          line.toLowerCase().includes(query.toLowerCase()),
        );
        if (matching.length === 0) return `No processes matching "${query}" found.\npgrep output:\n${pgrep}`;
        return `${header}\n${matching.join("\n")}\n\nTotal matching: ${matching.length}`;
      },
    });

    ctx.registerTool({
      name: "nixclaw_resources",
      description:
        "Get system resource usage: memory (free -h), disk (df -h), CPU load (uptime), and top processes by memory.",
      inputSchema: z.object({}),
      run: async () => {
        const [mem, disk, load, top] = await Promise.all([
          safeExec("free", ["-h"]),
          safeExec("df", ["-h", "--total", "-x", "tmpfs", "-x", "devtmpfs"]),
          safeExec("uptime", []),
          safeExec("ps", ["aux", "--sort=-%mem", "--no-headers"]),
        ]);
        const topLines = top.split("\n").slice(0, 10).join("\n");
        return `=== Memory ===\n${mem}\n=== Disk ===\n${disk}\n=== Load ===\n${load}\n=== Top 10 by Memory ===\n${topLines}`;
      },
    });

    ctx.registerTool({
      name: "nixclaw_journal",
      description:
        "Read systemd journal logs for a service. Returns the most recent log entries.",
      inputSchema: z.object({
        service: z.string().describe("Systemd service name (e.g. 'nixclaw', 'nginx', 'docker')"),
        lines: z.number().optional().describe("Number of recent lines to return (default 50)"),
      }),
      run: async (input) => {
        const { service, lines } = input as { service: string; lines?: number };
        return safeExec("journalctl", [
          "-u", service,
          "--no-pager",
          "-n", String(lines ?? 50),
          "--output=short-iso",
        ]);
      },
    });

    ctx.registerTool({
      name: "nixclaw_network",
      description:
        "Get network information: listening ports, active connections, and network interfaces.",
      inputSchema: z.object({
        focus: z.enum(["ports", "connections", "interfaces", "all"]).optional()
          .describe("What to focus on (default: all)"),
      }),
      run: async (input) => {
        const { focus } = input as { focus?: string };
        const sections: string[] = [];

        if (!focus || focus === "all" || focus === "ports") {
          const ports = await safeExec("ss", ["-tlnp"]);
          sections.push(`=== Listening Ports ===\n${ports}`);
        }
        if (!focus || focus === "all" || focus === "connections") {
          const conns = await safeExec("ss", ["-tnp"]);
          sections.push(`=== Active Connections ===\n${conns}`);
        }
        if (!focus || focus === "all" || focus === "interfaces") {
          const ifaces = await safeExec("ip", ["addr"]);
          sections.push(`=== Network Interfaces ===\n${ifaces}`);
        }
        return sections.join("\n\n");
      },
    });

    ctx.registerTool({
      name: "nixclaw_read_file",
      description:
        "Read the contents of a file. Only files within allowed directories can be read. Max 10KB returned.",
      inputSchema: z.object({
        path: z.string().describe("Absolute path to the file to read"),
        lines: z.number().optional().describe("Number of lines from the end (like tail -n). Omit for full file."),
      }),
      run: async (input) => {
        const { path, lines } = input as { path: string; lines?: number };

        let resolvedPath: string;
        try {
          resolvedPath = realpathSync(resolve(path));
        } catch {
          resolvedPath = resolve(path);
        }
        const isAllowed = allowedPaths.some((allowed) => {
          const normalizedAllowed = resolve(allowed);
          return resolvedPath === normalizedAllowed || resolvedPath.startsWith(normalizedAllowed + "/");
        });
        if (!isAllowed) {
          return `BLOCKED: Reading "${path}" is not permitted. Allowed paths: ${allowedPaths.join(", ")}`;
        }

        try {
          if (lines) {
            return await safeExec("tail", ["-n", String(lines), path]);
          }
          const content = readFileSync(path, "utf-8");
          if (content.length > 10240) {
            return content.slice(0, 10240) + `\n... (truncated at 10KB, file is ${content.length} bytes)`;
          }
          return content;
        } catch (err) {
          return `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    });

    ctx.registerTool({
      name: "nixclaw_query",
      description:
        "Run a read-only system query using an allowed command. Commands are restricted to an allowlist and arguments are sanitized to prevent shell injection. Use this when no specific tool exists for the information you need.",
      inputSchema: z.object({
        command: z.string().describe("Command to run (must be in allowlist: ps, pgrep, free, df, ss, journalctl, systemctl, ls, cat, head, tail, git, nix, etc.)"),
        args: z.array(z.string()).describe("Command arguments as an array of strings"),
      }),
      run: async (input) => {
        const { command, args } = input as { command: string; args: string[] };
        return safeExec(command, args);
      },
    });

    ctx.logger.info("Observation tools registered (6 tools)");
  }

  async shutdown(): Promise<void> {}
}
