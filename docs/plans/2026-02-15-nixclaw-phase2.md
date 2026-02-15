# NixClaw Phase 2: NixOS-Native Personal AI Assistant

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Evolve NixClaw from a basic chat agent into an observant, secure, NixOS-aware personal AI assistant — inspired by PicoClaw/OpenClaw's patterns but leveraging NixOS's unique declarative capabilities.

**Architecture:** Seven feature pillars implemented as plugins following the existing `NixClawPlugin` pattern. Each pillar adds tools and/or modifies core behavior. The security layer (tool policies, approval workflow, DM pairing) wraps around the existing `PluginHost.getTools()` path so all tools are subject to policy enforcement. The personality system injects workspace markdown files into the Agent's system prompt. The NixOS layer adds generation-aware tools that no other agent platform can offer.

**Tech Stack:** TypeScript ESM, Zod v4 (`z.toJSONSchema()`), Vitest, `execFile` (NOT `exec`) for all shell commands, `better-sqlite3` for state, `grammy` for Telegram, `fastify` for WebUI.

**Conventions (CRITICAL):**
- All imports use `.js` extension (ESM)
- Tests use `vitest` with `describe/it/expect/vi`
- Test DBs go in `/tmp/nixclaw-*-test.db`, cleaned in `afterEach`
- Plugins implement `NixClawPlugin` interface from `src/core/types.ts`
- Tools use `z.object({})` for input schemas, `run` returns `Promise<string>`
- All shell execution via `execFile` (never `exec` or `child_process.spawn` with `shell: true`)
- `src/index.ts` is the integration wiring point — only the plan orchestrator modifies it

**Current state:** 45 tests, 18 files, 26 commits. All passing.

---

## Pillar 1: Observation Tools

**Why:** The agent currently can't answer basic questions like "how many Chrome windows are open?" because it has no flexible observation tools.

### Task 1: Safe Command Runner Module

**Files:**
- Create: `src/tools/observe/safe-exec.ts`
- Test: `src/tools/observe/safe-exec.test.ts`

**Step 1: Write the failing test**

```typescript
// src/tools/observe/safe-exec.test.ts
import { describe, it, expect } from "vitest";
import { safeExec, isCommandAllowed, ALLOWED_COMMANDS, BLOCKED_PATTERNS } from "./safe-exec.js";

describe("safe-exec", () => {
  describe("isCommandAllowed", () => {
    it("allows whitelisted commands", () => {
      expect(isCommandAllowed("ps", ["aux"])).toBe(true);
      expect(isCommandAllowed("free", ["-h"])).toBe(true);
      expect(isCommandAllowed("hostname", [])).toBe(true);
    });

    it("blocks non-whitelisted commands", () => {
      expect(isCommandAllowed("rm", ["-rf", "/"])).toBe(false);
      expect(isCommandAllowed("dd", ["if=/dev/zero"])).toBe(false);
      expect(isCommandAllowed("sudo", ["anything"])).toBe(false);
    });

    it("blocks dangerous argument patterns even in allowed commands", () => {
      expect(isCommandAllowed("ls", ["; rm -rf /"])).toBe(false);
      expect(isCommandAllowed("cat", ["$(whoami)"])).toBe(false);
      expect(isCommandAllowed("find", ["-exec", "rm"])).toBe(false);
    });
  });

  describe("safeExec", () => {
    it("executes allowed commands", async () => {
      const result = await safeExec("hostname", []);
      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    });

    it("rejects blocked commands", async () => {
      const result = await safeExec("rm", ["-rf", "/"]);
      expect(result).toContain("BLOCKED");
    });

    it("truncates output exceeding maxBytes", async () => {
      const result = await safeExec("ps", ["aux"], { maxBytes: 100 });
      expect(result.length).toBeLessThanOrEqual(150); // 100 + truncation notice
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd ~/nixclaw && npx vitest run src/tools/observe/safe-exec.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// src/tools/observe/safe-exec.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export const ALLOWED_COMMANDS = new Set([
  // Process observation
  "ps", "pgrep", "pidof",
  // System resources
  "free", "df", "du", "lsblk", "lscpu", "lsmem",
  // Network
  "ss", "ip",
  // Services
  "systemctl", "journalctl",
  // Files (read-only)
  "ls", "cat", "head", "tail", "wc", "file", "stat", "find", "realpath",
  // System info
  "uptime", "hostname", "uname", "who", "w", "last", "date",
  // Nix (read-only)
  "nix", "nixos-option", "nixos-version", "nixos-rebuild",
  // Dev (read-only)
  "git",
  // Hardware
  "sensors", "lsusb", "lspci",
]);

export const BLOCKED_PATTERNS = [
  /[;&|`]/, // shell metacharacters
  /\$\(/, /\$\{/, // command/variable substitution
  />\s*[^\s]/, // output redirection
  /--delete/, /--force/, /-rf\b/,
  /--hard/, /--no-verify/,
  /nixos-rebuild\s+(switch|boot|test)/, // only list-generations allowed
  /nix-collect-garbage/,
  /\bpush\b/, // git push
];

export function isCommandAllowed(command: string, args: string[]): boolean {
  if (!ALLOWED_COMMANDS.has(command)) return false;
  const fullArgs = args.join(" ");
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(fullArgs)) return false;
  }
  return true;
}

interface SafeExecOptions {
  maxBytes?: number;
  timeout?: number;
  cwd?: string;
}

export async function safeExec(
  command: string,
  args: string[],
  options: SafeExecOptions = {},
): Promise<string> {
  const { maxBytes = 10240, timeout = 30000, cwd } = options;

  if (!isCommandAllowed(command, args)) {
    return `BLOCKED: Command "${command} ${args.join(" ")}" is not permitted.`;
  }

  try {
    const { stdout, stderr } = await exec(command, args, { timeout, cwd });
    let output = stdout + (stderr ? `\nSTDERR: ${stderr}` : "");
    if (output.length > maxBytes) {
      output = output.slice(0, maxBytes) + `\n... (truncated at ${maxBytes} bytes)`;
    }
    return output;
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    return `Error: ${e.message}\n${e.stdout ?? ""}\n${e.stderr ?? ""}`.trim();
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd ~/nixclaw && npx vitest run src/tools/observe/safe-exec.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd ~/nixclaw
git add src/tools/observe/safe-exec.ts src/tools/observe/safe-exec.test.ts
git commit -m "feat: add safe command execution with allowlist and argument sanitization"
```

---

### Task 2: Observation Tools Plugin

**Files:**
- Create: `src/tools/observe/index.ts`
- Create: `src/tools/observe/index.test.ts`

**Step 1: Write the failing test**

```typescript
// src/tools/observe/index.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { ObservePlugin } from "./index.js";
import { EventBus } from "../../core/event-bus.js";
import { StateStore } from "../../core/state.js";
import type { PluginContext, Tool } from "../../core/types.js";
import { unlinkSync } from "node:fs";

const TEST_DB = "/tmp/nixclaw-observe-test.db";

describe("ObservePlugin", () => {
  let state: StateStore;

  afterEach(() => {
    try { state?.close(); } catch {}
    try { unlinkSync(TEST_DB); } catch {}
  });

  it("registers all observation tools", async () => {
    const plugin = new ObservePlugin();
    const bus = new EventBus();
    state = new StateStore(TEST_DB);
    const tools: Tool[] = [];

    const ctx: PluginContext = {
      eventBus: bus,
      registerTool: (t) => tools.push(t),
      state,
      config: { allowedReadPaths: ["/tmp", "/home"] },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };

    await plugin.init(ctx);

    const names = tools.map((t) => t.name);
    expect(names).toContain("nixclaw_processes");
    expect(names).toContain("nixclaw_resources");
    expect(names).toContain("nixclaw_journal");
    expect(names).toContain("nixclaw_network");
    expect(names).toContain("nixclaw_read_file");
    expect(names).toContain("nixclaw_query");
  });

  it("nixclaw_processes returns process info", async () => {
    const plugin = new ObservePlugin();
    const bus = new EventBus();
    state = new StateStore(TEST_DB);
    const tools: Tool[] = [];

    const ctx: PluginContext = {
      eventBus: bus,
      registerTool: (t) => tools.push(t),
      state,
      config: {},
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };

    await plugin.init(ctx);
    const processTool = tools.find((t) => t.name === "nixclaw_processes")!;
    const result = await processTool.run({ query: "node" });
    expect(typeof result).toBe("string");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd ~/nixclaw && npx vitest run src/tools/observe/index.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/tools/observe/index.ts
import { z } from "zod";
import { readFileSync } from "node:fs";
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
        // Filter ps output for matching lines
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

        // Path allowlist check
        const isAllowed = allowedPaths.some((allowed) => path.startsWith(allowed));
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
```

**Step 4: Run tests**

Run: `cd ~/nixclaw && npx vitest run src/tools/observe/`
Expected: PASS

**Step 5: Commit**

```bash
cd ~/nixclaw
git add src/tools/observe/index.ts src/tools/observe/index.test.ts
git commit -m "feat: add observation tools plugin (processes, resources, journal, network, read_file, query)"
```

---

## Pillar 2: Personality & Workspace Model

**Why:** The agent has a hardcoded system prompt. PicoClaw's approach — loading IDENTITY.md, SOUL.md, USER.md from a workspace directory — lets the user customize the agent's personality without touching code.

### Task 3: Personality Loader

**Files:**
- Create: `src/core/personality.ts`
- Create: `src/core/personality.test.ts`
- Modify: `src/core/agent.ts` — inject personality into system prompt
- Modify: `src/core/config.ts` — add `workspaceDir` to config

**Step 1: Write the failing test**

```typescript
// src/core/personality.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadPersonality } from "./personality.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

const TEST_DIR = "/tmp/nixclaw-personality-test";

describe("loadPersonality", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("loads IDENTITY.md into prompt", () => {
    writeFileSync(`${TEST_DIR}/IDENTITY.md`, "You are TestClaw, a testing assistant.");
    const prompt = loadPersonality(TEST_DIR);
    expect(prompt).toContain("TestClaw");
  });

  it("loads SOUL.md and USER.md if present", () => {
    writeFileSync(`${TEST_DIR}/IDENTITY.md`, "Identity here.");
    writeFileSync(`${TEST_DIR}/SOUL.md`, "Be kind and helpful.");
    writeFileSync(`${TEST_DIR}/USER.md`, "User prefers concise answers.");
    const prompt = loadPersonality(TEST_DIR);
    expect(prompt).toContain("Be kind");
    expect(prompt).toContain("concise answers");
  });

  it("returns default prompt when no files exist", () => {
    const prompt = loadPersonality(TEST_DIR);
    expect(prompt).toContain("NixClaw");
    expect(prompt.length).toBeGreaterThan(50);
  });

  it("loads MEMORY.md as persistent knowledge", () => {
    writeFileSync(`${TEST_DIR}/IDENTITY.md`, "Identity.");
    mkdirSync(`${TEST_DIR}/memory`, { recursive: true });
    writeFileSync(`${TEST_DIR}/memory/MEMORY.md`, "User's bluetooth broke on gen 487.");
    const prompt = loadPersonality(TEST_DIR);
    expect(prompt).toContain("gen 487");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd ~/nixclaw && npx vitest run src/core/personality.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/core/personality.ts
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_PROMPT = `You are NixClaw, a personal AI agent running on a NixOS system.
You help your user manage their NixOS system, development workflows, and daily tasks.
Be concise and direct. When using tools, explain what you're doing briefly.
If a task requires system changes (like nixos-rebuild), propose the change and ask the user to execute it.`;

function tryRead(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8").trim();
}

export function loadPersonality(workspaceDir: string): string {
  const identity = tryRead(join(workspaceDir, "IDENTITY.md"));
  if (!identity) return DEFAULT_PROMPT;

  const sections: string[] = [identity];

  const soul = tryRead(join(workspaceDir, "SOUL.md"));
  if (soul) sections.push(`## Values & Behavior\n${soul}`);

  const user = tryRead(join(workspaceDir, "USER.md"));
  if (user) sections.push(`## User Preferences\n${user}`);

  const memory = tryRead(join(workspaceDir, "memory", "MEMORY.md"));
  if (memory) sections.push(`## Persistent Knowledge\n${memory}`);

  return sections.join("\n\n");
}
```

**Step 4: Run test**

Run: `cd ~/nixclaw && npx vitest run src/core/personality.test.ts`
Expected: PASS

**Step 5: Update config to add `workspaceDir`**

Modify `src/core/config.ts`: Add `workspaceDir: string` to `NixClawConfig`, defaulting to `join(homedir(), ".config/nixclaw")`. Add to `DEFAULT_CONFIG`.

**Step 6: Update Agent to use personality loader**

Modify `src/core/agent.ts`:
- Import `loadPersonality` from `./personality.js`
- Replace hardcoded `SYSTEM_PROMPT` with `loadPersonality(config.workspaceDir)` in the constructor
- Store as `private systemPrompt: string`

**Step 7: Run full tests**

Run: `cd ~/nixclaw && npx vitest run`
Expected: All 47+ tests pass

**Step 8: Commit**

```bash
cd ~/nixclaw
git add src/core/personality.ts src/core/personality.test.ts src/core/config.ts src/core/agent.ts
git commit -m "feat: add personality system — load IDENTITY.md, SOUL.md, USER.md from workspace"
```

---

### Task 4: Heartbeat Service

**Files:**
- Create: `src/tools/heartbeat/index.ts`
- Create: `src/tools/heartbeat/index.test.ts`

**Step 1: Write the failing test**

```typescript
// src/tools/heartbeat/index.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { HeartbeatPlugin } from "./index.js";
import { EventBus } from "../../core/event-bus.js";
import { StateStore } from "../../core/state.js";
import type { PluginContext, NixClawMessage } from "../../core/types.js";
import { mkdirSync, writeFileSync, rmSync, unlinkSync } from "node:fs";

const TEST_DIR = "/tmp/nixclaw-heartbeat-test";
const TEST_DB = "/tmp/nixclaw-heartbeat-test.db";

describe("HeartbeatPlugin", () => {
  afterEach(() => {
    try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
    try { unlinkSync(TEST_DB); } catch {}
  });

  it("reads HEARTBEAT.md and emits tasks as messages", async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(`${TEST_DIR}/HEARTBEAT.md`, "Check system status and report any anomalies.");

    const bus = new EventBus();
    const state = new StateStore(TEST_DB);
    const messages: unknown[] = [];
    bus.on("message:incoming", (msg) => messages.push(msg));

    const plugin = new HeartbeatPlugin();
    const ctx: PluginContext = {
      eventBus: bus,
      registerTool: vi.fn(),
      state,
      config: { workspaceDir: TEST_DIR, intervalMinutes: 0 },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };

    await plugin.init(ctx);
    // Manually trigger a heartbeat tick
    plugin.tick();

    expect(messages).toHaveLength(1);
    const msg = messages[0] as NixClawMessage;
    expect(msg.channel).toBe("heartbeat");
    expect(msg.text).toContain("Check system status");

    state.close();
    await plugin.shutdown();
  });

  it("does nothing when HEARTBEAT.md is absent", async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    // No HEARTBEAT.md written

    const bus = new EventBus();
    const state = new StateStore(TEST_DB);
    const messages: unknown[] = [];
    bus.on("message:incoming", (msg) => messages.push(msg));

    const plugin = new HeartbeatPlugin();
    const ctx: PluginContext = {
      eventBus: bus,
      registerTool: vi.fn(),
      state,
      config: { workspaceDir: TEST_DIR, intervalMinutes: 0 },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };

    await plugin.init(ctx);
    plugin.tick();

    expect(messages).toHaveLength(0);

    state.close();
    await plugin.shutdown();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd ~/nixclaw && npx vitest run src/tools/heartbeat/index.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/tools/heartbeat/index.ts
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { NixClawPlugin, PluginContext, NixClawMessage } from "../../core/types.js";
import type { EventBus } from "../../core/event-bus.js";

interface HeartbeatConfig {
  workspaceDir: string;
  intervalMinutes?: number;
}

export class HeartbeatPlugin implements NixClawPlugin {
  name = "heartbeat";
  version = "0.1.0";
  private interval?: ReturnType<typeof setInterval>;
  private eventBus?: EventBus;
  private workspaceDir = "";

  async init(ctx: PluginContext): Promise<void> {
    const config = ctx.config as unknown as HeartbeatConfig;
    this.workspaceDir = config.workspaceDir;
    this.eventBus = ctx.eventBus;
    const minutes = config.intervalMinutes ?? 30;

    if (minutes > 0) {
      this.interval = setInterval(() => this.tick(), minutes * 60 * 1000);
      ctx.logger.info(`Heartbeat service started (every ${minutes} minutes)`);
    }
  }

  tick(): void {
    const heartbeatPath = join(this.workspaceDir, "HEARTBEAT.md");
    if (!existsSync(heartbeatPath)) return;

    const content = readFileSync(heartbeatPath, "utf-8").trim();
    if (!content) return;

    const msg: NixClawMessage = {
      id: randomUUID(),
      channel: "heartbeat",
      sender: "heartbeat",
      text: `[Heartbeat Task] ${content}`,
      timestamp: new Date(),
    };
    this.eventBus?.emit("message:incoming", msg);
  }

  async shutdown(): Promise<void> {
    if (this.interval) clearInterval(this.interval);
  }
}
```

**Step 4: Run test**

Run: `cd ~/nixclaw && npx vitest run src/tools/heartbeat/index.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd ~/nixclaw
git add src/tools/heartbeat/index.ts src/tools/heartbeat/index.test.ts
git commit -m "feat: add heartbeat service — reads HEARTBEAT.md and triggers agent periodically"
```

---

## Pillar 3: Security — Tool Policies

**Why:** Right now all tools are available to all channels and all users. We need per-tool, per-channel, per-user policies.

### Task 5: Tool Policy Engine

**Files:**
- Create: `src/core/tool-policy.ts`
- Create: `src/core/tool-policy.test.ts`
- Modify: `src/core/plugin-host.ts` — filter tools through policy

**Step 1: Write the failing test**

```typescript
// src/core/tool-policy.test.ts
import { describe, it, expect } from "vitest";
import { ToolPolicy, evaluatePolicy } from "./tool-policy.js";

describe("ToolPolicy", () => {
  it("allows tools not mentioned in any policy", () => {
    const policies: ToolPolicy[] = [];
    expect(evaluatePolicy(policies, "nixclaw_processes", "telegram", "user1")).toBe("allow");
  });

  it("blocks tools in deny list", () => {
    const policies: ToolPolicy[] = [
      { tool: "nixclaw_query", effect: "deny", channels: ["telegram"] },
    ];
    expect(evaluatePolicy(policies, "nixclaw_query", "telegram", "user1")).toBe("deny");
    expect(evaluatePolicy(policies, "nixclaw_query", "webui", "user1")).toBe("allow");
  });

  it("requires approval for tools marked as such", () => {
    const policies: ToolPolicy[] = [
      { tool: "nixclaw_query", effect: "approve", channels: ["telegram"] },
    ];
    expect(evaluatePolicy(policies, "nixclaw_query", "telegram", "user1")).toBe("approve");
  });

  it("supports wildcard tool matching", () => {
    const policies: ToolPolicy[] = [
      { tool: "*", effect: "deny", channels: ["telegram"], users: ["unknown-user"] },
    ];
    expect(evaluatePolicy(policies, "nixclaw_anything", "telegram", "unknown-user")).toBe("deny");
    expect(evaluatePolicy(policies, "nixclaw_anything", "telegram", "owner")).toBe("allow");
  });

  it("first matching policy wins", () => {
    const policies: ToolPolicy[] = [
      { tool: "nixclaw_query", effect: "allow", users: ["owner"] },
      { tool: "nixclaw_query", effect: "deny" },
    ];
    expect(evaluatePolicy(policies, "nixclaw_query", "terminal", "owner")).toBe("allow");
    expect(evaluatePolicy(policies, "nixclaw_query", "terminal", "someone-else")).toBe("deny");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd ~/nixclaw && npx vitest run src/core/tool-policy.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/core/tool-policy.ts
export interface ToolPolicy {
  tool: string; // tool name or "*" for wildcard
  effect: "allow" | "deny" | "approve";
  channels?: string[]; // if set, only applies to these channels
  users?: string[]; // if set, only applies to these users
}

export type PolicyDecision = "allow" | "deny" | "approve";

export function evaluatePolicy(
  policies: ToolPolicy[],
  toolName: string,
  channel: string,
  sender: string,
): PolicyDecision {
  for (const policy of policies) {
    // Check tool match
    if (policy.tool !== "*" && policy.tool !== toolName) continue;

    // Check channel filter
    if (policy.channels && !policy.channels.includes(channel)) continue;

    // Check user filter
    if (policy.users && !policy.users.includes(sender)) continue;

    // All filters match — this policy applies
    return policy.effect;
  }

  // No matching policy — default allow
  return "allow";
}
```

**Step 4: Run test**

Run: `cd ~/nixclaw && npx vitest run src/core/tool-policy.test.ts`
Expected: PASS

**Step 5: Integrate into PluginHost**

Modify `src/core/plugin-host.ts`:
- Add `getToolsForContext(channel: string, sender: string): Tool[]` method
- This calls `evaluatePolicy` for each tool and filters out denied ones
- Tools with "approve" decision get wrapped to add approval metadata

**Step 6: Update Agent to pass context**

Modify `src/core/agent.ts` so `handleMessage` calls `pluginHost.getToolsForContext(msg.channel, msg.sender)` instead of `pluginHost.getTools()`.

**Step 7: Run full tests**

Run: `cd ~/nixclaw && npx vitest run`
Expected: All tests pass

**Step 8: Commit**

```bash
cd ~/nixclaw
git add src/core/tool-policy.ts src/core/tool-policy.test.ts src/core/plugin-host.ts src/core/agent.ts
git commit -m "feat: add tool policy engine — per-tool, per-channel, per-user allow/deny/approve"
```

---

## Pillar 4: Security — Approval Workflow

**Why:** When NixClaw (or Claude Code sessions) want to do something dangerous, the user should be able to approve/deny from Telegram.

### Task 6: Approval Store and API

**Files:**
- Create: `src/core/approval.ts`
- Create: `src/core/approval.test.ts`
- Modify: `src/channels/webui/routes.ts` — add approval API endpoints

**Step 1: Write the failing test**

```typescript
// src/core/approval.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { ApprovalStore } from "./approval.js";
import { StateStore } from "./state.js";
import { unlinkSync } from "node:fs";

const TEST_DB = "/tmp/nixclaw-approval-test.db";

describe("ApprovalStore", () => {
  let state: StateStore;
  let approvals: ApprovalStore;

  afterEach(() => {
    try { state?.close(); } catch {}
    try { unlinkSync(TEST_DB); } catch {}
  });

  it("creates a pending approval request", () => {
    state = new StateStore(TEST_DB);
    approvals = new ApprovalStore(state);

    const id = approvals.requestApproval({
      tool: "Bash",
      input: "git push origin main",
      session: "claude-session-1",
      requester: "claude-code",
    });

    const req = approvals.get(id);
    expect(req).toBeDefined();
    expect(req!.status).toBe("pending");
    expect(req!.tool).toBe("Bash");
  });

  it("approves a pending request", () => {
    state = new StateStore(TEST_DB);
    approvals = new ApprovalStore(state);

    const id = approvals.requestApproval({
      tool: "Bash",
      input: "npm test",
      session: "s1",
      requester: "claude-code",
    });

    approvals.decide(id, "allow");
    expect(approvals.get(id)!.status).toBe("allow");
  });

  it("denies a pending request", () => {
    state = new StateStore(TEST_DB);
    approvals = new ApprovalStore(state);

    const id = approvals.requestApproval({
      tool: "Write",
      input: "/etc/hosts",
      session: "s1",
      requester: "claude-code",
    });

    approvals.decide(id, "deny");
    expect(approvals.get(id)!.status).toBe("deny");
  });

  it("lists pending approvals", () => {
    state = new StateStore(TEST_DB);
    approvals = new ApprovalStore(state);

    approvals.requestApproval({ tool: "A", input: "1", session: "s1", requester: "x" });
    approvals.requestApproval({ tool: "B", input: "2", session: "s1", requester: "x" });

    const pending = approvals.listPending();
    expect(pending).toHaveLength(2);
  });

  it("times out old pending requests", () => {
    state = new StateStore(TEST_DB);
    approvals = new ApprovalStore(state);

    const id = approvals.requestApproval({
      tool: "Bash",
      input: "test",
      session: "s1",
      requester: "x",
    });

    // Manually expire by setting createdAt in the past
    approvals.expireOlderThan(0);
    expect(approvals.get(id)!.status).toBe("expired");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd ~/nixclaw && npx vitest run src/core/approval.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/core/approval.ts
import { randomUUID } from "node:crypto";
import type { StateStore } from "./state.js";

export interface ApprovalRequest {
  id: string;
  tool: string;
  input: string;
  session: string;
  requester: string;
  status: "pending" | "allow" | "deny" | "expired";
  createdAt: number;
}

const NAMESPACE = "approvals";

export class ApprovalStore {
  constructor(private state: StateStore) {}

  requestApproval(req: Omit<ApprovalRequest, "id" | "status" | "createdAt">): string {
    const id = randomUUID().slice(0, 8);
    const approval: ApprovalRequest = {
      ...req,
      id,
      status: "pending",
      createdAt: Date.now(),
    };
    this.state.setJSON(NAMESPACE, id, approval);
    return id;
  }

  get(id: string): ApprovalRequest | undefined {
    return this.state.getJSON<ApprovalRequest>(NAMESPACE, id);
  }

  decide(id: string, decision: "allow" | "deny"): void {
    const req = this.get(id);
    if (!req || req.status !== "pending") return;
    req.status = decision;
    this.state.setJSON(NAMESPACE, id, req);
  }

  listPending(): ApprovalRequest[] {
    // Scan all approvals — the KV store doesn't support range queries,
    // so we use a secondary index key that tracks pending IDs
    const index = this.state.getJSON<string[]>(NAMESPACE, "_pending_index") ?? [];
    return index
      .map((id) => this.get(id))
      .filter((r): r is ApprovalRequest => r !== undefined && r.status === "pending");
  }

  expireOlderThan(maxAgeMs: number): void {
    const index = this.state.getJSON<string[]>(NAMESPACE, "_pending_index") ?? [];
    const now = Date.now();
    for (const id of index) {
      const req = this.get(id);
      if (req && req.status === "pending" && now - req.createdAt > maxAgeMs) {
        req.status = "expired";
        this.state.setJSON(NAMESPACE, id, req);
      }
    }
  }
}
```

Note: The `requestApproval` method must also maintain the `_pending_index`. Add `index.push(id)` and `this.state.setJSON(NAMESPACE, "_pending_index", index)` after creating the approval.

**Step 4: Run test**

Run: `cd ~/nixclaw && npx vitest run src/core/approval.test.ts`
Expected: PASS

**Step 5: Add WebUI approval API endpoints**

Modify `src/channels/webui/routes.ts` — add three new routes:

```typescript
// POST /api/approve — create approval request (called by Claude Code hook)
// GET  /api/approve/:id — poll approval status (called by Claude Code hook)
// POST /api/approve/:id/decide — submit decision (called by Telegram handler)
```

**Step 6: Run full tests**

Run: `cd ~/nixclaw && npx vitest run`
Expected: All tests pass

**Step 7: Commit**

```bash
cd ~/nixclaw
git add src/core/approval.ts src/core/approval.test.ts src/channels/webui/routes.ts
git commit -m "feat: add approval workflow — store, API endpoints for remote permission management"
```

---

### Task 7: Telegram Approval Commands

**Files:**
- Modify: `src/channels/telegram/index.ts` — handle `/allow` and `/deny` commands
- Create: `src/channels/telegram/approval.test.ts`

**Step 1: Write the failing test**

```typescript
// src/channels/telegram/approval.test.ts
import { describe, it, expect, vi } from "vitest";
import { parseApprovalCommand } from "./approval.js";

describe("parseApprovalCommand", () => {
  it("parses /allow <id>", () => {
    const result = parseApprovalCommand("/allow abc123");
    expect(result).toEqual({ decision: "allow", id: "abc123" });
  });

  it("parses /deny <id>", () => {
    const result = parseApprovalCommand("/deny abc123");
    expect(result).toEqual({ decision: "deny", id: "abc123" });
  });

  it("returns null for non-approval messages", () => {
    expect(parseApprovalCommand("hello")).toBeNull();
    expect(parseApprovalCommand("/start")).toBeNull();
  });

  it("returns null when id is missing", () => {
    expect(parseApprovalCommand("/allow")).toBeNull();
    expect(parseApprovalCommand("/deny ")).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd ~/nixclaw && npx vitest run src/channels/telegram/approval.test.ts`
Expected: FAIL

**Step 3: Write implementation**

Create `src/channels/telegram/approval.ts`:

```typescript
export function parseApprovalCommand(text: string): { decision: "allow" | "deny"; id: string } | null {
  const match = text.match(/^\/(allow|deny)\s+(\S+)/);
  if (!match) return null;
  return { decision: match[1] as "allow" | "deny", id: match[2] };
}
```

Then modify `src/channels/telegram/index.ts`:
- In `bot.on("message:text")`, check `parseApprovalCommand(text)` BEFORE emitting `message:incoming`
- If it's an approval command, call the approval API (via EventBus event `approval:decide`) and reply with confirmation
- New EventBus event: `approval:request` — when fired, the Telegram channel sends a formatted approval request message to the owner

**Step 4: Run tests**

Run: `cd ~/nixclaw && npx vitest run src/channels/telegram/`
Expected: PASS

**Step 5: Commit**

```bash
cd ~/nixclaw
git add src/channels/telegram/approval.ts src/channels/telegram/approval.test.ts src/channels/telegram/index.ts
git commit -m "feat: add Telegram /allow and /deny commands for remote approval workflow"
```

---

### Task 8: Claude Code Hook Script

**Files:**
- Create: `scripts/nixclaw-hook.sh`

This is a standalone shell script that Claude Code's `PreToolUse` hook calls. It:

1. POSTs to `http://localhost:3344/api/approve` with tool name + input
2. Polls `GET /api/approve/:id` every second
3. Returns JSON `{"decision": "allow"}` or `{"decision": "deny"}`
4. Times out after 5 minutes with `{"decision": "deny"}`

**Step 1: Write the hook script**

```bash
#!/usr/bin/env bash
# scripts/nixclaw-hook.sh — Claude Code PreToolUse hook
# Sends approval request to NixClaw, waits for Telegram response
set -euo pipefail

NIXCLAW_URL="${NIXCLAW_URL:-http://localhost:3344}"
TIMEOUT="${NIXCLAW_APPROVAL_TIMEOUT:-300}"
TOOL="${CLAUDE_TOOL:-unknown}"
INPUT="${CLAUDE_INPUT:-}"

# Request approval
RESPONSE=$(curl -sf -X POST "$NIXCLAW_URL/api/approve" \
  -H 'Content-Type: application/json' \
  -d "{\"tool\":\"$TOOL\",\"input\":$(echo "$INPUT" | head -c 500 | jq -Rs .),\"session\":\"${CLAUDE_SESSION:-unknown}\",\"requester\":\"claude-code\"}")

REQUEST_ID=$(echo "$RESPONSE" | jq -r '.id')

if [ -z "$REQUEST_ID" ] || [ "$REQUEST_ID" = "null" ]; then
  echo '{"decision": "deny"}'
  exit 0
fi

# Poll for decision
for i in $(seq 1 "$TIMEOUT"); do
  STATUS=$(curl -sf "$NIXCLAW_URL/api/approve/$REQUEST_ID" || echo '{}')
  DECISION=$(echo "$STATUS" | jq -r '.status // "pending"')

  if [ "$DECISION" = "allow" ] || [ "$DECISION" = "deny" ]; then
    echo "{\"decision\": \"$DECISION\"}"
    exit 0
  fi

  sleep 1
done

echo '{"decision": "deny"}'
```

**Step 2: Make executable and commit**

```bash
chmod +x ~/nixclaw/scripts/nixclaw-hook.sh
cd ~/nixclaw
git add scripts/nixclaw-hook.sh
git commit -m "feat: add Claude Code PreToolUse hook script for remote approval via NixClaw"
```

---

## Pillar 5: NixOS-Unique Layer

**Why:** This is what no other agent platform can do. NixOS's declarative model gives the agent superpowers.

### Task 9: NixOS Generation Tools

**Files:**
- Create: `src/tools/nixos/generations.ts`
- Create: `src/tools/nixos/generations.test.ts`
- Modify: `src/tools/nixos/index.ts` — register new generation tools

**Step 1: Write the failing test**

```typescript
// src/tools/nixos/generations.test.ts
import { describe, it, expect } from "vitest";
import { parseGenerations, diffGenerationPaths } from "./generations.js";

describe("NixOS Generations", () => {
  it("parses generation listing", () => {
    const output = `  1   2026-01-15 10:00   NixOS 25.11
  2   2026-01-16 14:30   NixOS 25.11
  3   2026-02-14 20:00   NixOS 25.11 (current)`;

    const gens = parseGenerations(output);
    expect(gens).toHaveLength(3);
    expect(gens[2].number).toBe(3);
    expect(gens[2].current).toBe(true);
    expect(gens[0].current).toBe(false);
  });

  it("diffs two generation closure paths", () => {
    const oldPkgs = new Set(["pkgA-1.0", "pkgB-2.0", "pkgC-3.0"]);
    const newPkgs = new Set(["pkgA-1.0", "pkgB-2.1", "pkgD-1.0"]);

    const diff = diffGenerationPaths(oldPkgs, newPkgs);
    expect(diff.added).toContain("pkgD-1.0");
    expect(diff.removed).toContain("pkgC-3.0");
    expect(diff.changed).toContainEqual({ pkg: "pkgB", from: "2.0", to: "2.1" });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd ~/nixclaw && npx vitest run src/tools/nixos/generations.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/tools/nixos/generations.ts
import { safeExec } from "../observe/safe-exec.js";

export interface Generation {
  number: number;
  date: string;
  description: string;
  current: boolean;
}

export function parseGenerations(output: string): Generation[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d+/.test(line))
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\S+ \S+)\s+(.+?)(\s*\(current\))?$/);
      if (!match) return null;
      return {
        number: parseInt(match[1], 10),
        date: match[2],
        description: match[3].trim(),
        current: !!match[4],
      };
    })
    .filter((g): g is Generation => g !== null);
}

export interface GenerationDiff {
  added: string[];
  removed: string[];
  changed: Array<{ pkg: string; from: string; to: string }>;
}

export function diffGenerationPaths(
  oldPkgs: Set<string>,
  newPkgs: Set<string>,
): GenerationDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: GenerationDiff["changed"] = [];

  // Index packages by name (strip version)
  const nameVersion = (s: string) => {
    const match = s.match(/^(.+?)-(\d[\d.]*)$/);
    return match ? { name: match[1], version: match[2] } : null;
  };

  const oldMap = new Map<string, string>();
  for (const p of oldPkgs) {
    const nv = nameVersion(p);
    if (nv) oldMap.set(nv.name, nv.version);
  }

  const newMap = new Map<string, string>();
  for (const p of newPkgs) {
    const nv = nameVersion(p);
    if (nv) newMap.set(nv.name, nv.version);
  }

  for (const [name, ver] of newMap) {
    const oldVer = oldMap.get(name);
    if (!oldVer) added.push(`${name}-${ver}`);
    else if (oldVer !== ver) changed.push({ pkg: name, from: oldVer, to: ver });
  }

  for (const [name, ver] of oldMap) {
    if (!newMap.has(name)) removed.push(`${name}-${ver}`);
  }

  return { added, removed, changed };
}

export async function listGenerations(): Promise<string> {
  return safeExec("nixos-rebuild", ["list-generations"]);
}

export async function getGenerationClosure(genNumber: number): Promise<Set<string>> {
  const profilePath = `/nix/var/nix/profiles/system-${genNumber}-link`;
  const output = await safeExec("nix-store", ["-qR", profilePath]);
  return new Set(
    output.split("\n")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => p.split("/").pop()!)
      .filter((p) => !p.startsWith("."))
  );
}

export async function diffGenerations(gen1: number, gen2: number): Promise<string> {
  const [closure1, closure2] = await Promise.all([
    getGenerationClosure(gen1),
    getGenerationClosure(gen2),
  ]);

  const diff = diffGenerationPaths(closure1, closure2);

  const lines: string[] = [`Generation ${gen1} → ${gen2}:`];
  if (diff.added.length > 0) lines.push(`\nAdded (${diff.added.length}):\n  ${diff.added.join("\n  ")}`);
  if (diff.removed.length > 0) lines.push(`\nRemoved (${diff.removed.length}):\n  ${diff.removed.join("\n  ")}`);
  if (diff.changed.length > 0) {
    lines.push(`\nChanged (${diff.changed.length}):`);
    for (const c of diff.changed) lines.push(`  ${c.pkg}: ${c.from} → ${c.to}`);
  }
  if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
    lines.push("  No package changes detected.");
  }

  return lines.join("\n");
}
```

**Step 4: Run test**

Run: `cd ~/nixclaw && npx vitest run src/tools/nixos/generations.test.ts`
Expected: PASS

**Step 5: Register generation tools in NixOS plugin**

Modify `src/tools/nixos/index.ts` to add two new tools:
- `nixclaw_generations` — list generations with dates and current marker
- `nixclaw_generation_diff` — diff two generations showing added/removed/changed packages

**Step 6: Run full tests**

Run: `cd ~/nixclaw && npx vitest run`
Expected: All tests pass

**Step 7: Commit**

```bash
cd ~/nixclaw
git add src/tools/nixos/generations.ts src/tools/nixos/generations.test.ts src/tools/nixos/index.ts
git commit -m "feat: add NixOS generation diffing — compare closures between generations"
```

---

### Task 10: NixOS Declarative State Query Tool

**Files:**
- Modify: `src/tools/nixos/commands.ts` — add `nixosOption` function
- Modify: `src/tools/nixos/index.ts` — register `nixclaw_nixos_option` tool

**Step 1: Add `nixosOption` to commands.ts**

```typescript
export async function nixosOption(optionPath: string): Promise<string> {
  return runCommand("nixos-option", [optionPath]);
}
```

**Step 2: Register `nixclaw_nixos_option` tool**

In `src/tools/nixos/index.ts`, add:
```typescript
ctx.registerTool({
  name: "nixclaw_nixos_option",
  description: "Query the current value and description of a NixOS configuration option (e.g. 'services.openssh.enable', 'networking.firewall.allowedTCPPorts')",
  inputSchema: z.object({
    option: z.string().describe("NixOS option path, e.g. 'services.openssh.enable'"),
  }),
  run: async (input) => {
    const { option } = input as { option: string };
    return nixosOption(option);
  },
});
```

**Step 3: Run full tests**

Run: `cd ~/nixclaw && npx vitest run`
Expected: All tests pass

**Step 4: Commit**

```bash
cd ~/nixclaw
git add src/tools/nixos/commands.ts src/tools/nixos/index.ts
git commit -m "feat: add nixos-option query tool for declarative state inspection"
```

---

## Pillar 6: Session Intelligence

**Why:** ConversationManager currently hard-truncates at 50 messages. PicoClaw auto-summarizes when context gets large, preserving important information.

### Task 11: Conversation Summarization

**Files:**
- Modify: `src/ai/context.ts` — add summarization logic
- Create: `src/ai/context-summarizer.test.ts`

**Step 1: Write the failing test**

```typescript
// src/ai/context-summarizer.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { ConversationManager } from "./context.js";
import { StateStore } from "../core/state.js";
import { unlinkSync } from "node:fs";

const TEST_DB = "/tmp/nixclaw-summarizer-test.db";

describe("ConversationManager summarization", () => {
  let state: StateStore;

  afterEach(() => {
    try { state?.close(); } catch {}
    try { unlinkSync(TEST_DB); } catch {}
  });

  it("triggers summarization when message count exceeds threshold", () => {
    state = new StateStore(TEST_DB);
    const cm = new ConversationManager(state, { summarizeThreshold: 5 });

    // Add 6 messages
    for (let i = 0; i < 3; i++) {
      cm.addUserMessage("test-conv", `Message ${i}`);
      cm.addAssistantMessage("test-conv", `Reply ${i}`);
    }

    expect(cm.needsSummarization("test-conv")).toBe(true);
  });

  it("does not need summarization below threshold", () => {
    state = new StateStore(TEST_DB);
    const cm = new ConversationManager(state, { summarizeThreshold: 20 });

    cm.addUserMessage("test-conv", "Hello");
    cm.addAssistantMessage("test-conv", "Hi");

    expect(cm.needsSummarization("test-conv")).toBe(false);
  });

  it("stores and retrieves summary", () => {
    state = new StateStore(TEST_DB);
    const cm = new ConversationManager(state);

    cm.setSummary("test-conv", "Previous conversation discussed NixOS bluetooth issues.");

    const messages = cm.getMessages("test-conv");
    // When a summary exists and no messages, it should be returned as a system-like context
    expect(cm.getSummary("test-conv")).toContain("bluetooth");
  });
});
```

**Step 2: Run test, implement, run test**

The implementation adds:
- `needsSummarization(conversationId)` — returns true if message count exceeds threshold
- `setSummary(conversationId, summary)` — stores summary in state
- `getSummary(conversationId)` — retrieves summary
- `getMessages` now prepends summary as first user message when it exists and messages have been trimmed

The actual summarization (calling Claude to summarize) happens in `Agent.handleMessage` — after getting a response, check `needsSummarization`, and if true, call Claude with a summarization prompt, then `setSummary` and trim messages.

**Step 3: Commit**

```bash
cd ~/nixclaw
git add src/ai/context.ts src/ai/context-summarizer.test.ts
git commit -m "feat: add conversation summarization — auto-summarize when context exceeds threshold"
```

---

## Pillar 7: DM Pairing Security

**Why:** Currently anyone who finds the Telegram bot can message it. OpenClaw requires unknown senders to enter a pairing code.

### Task 12: Telegram DM Pairing

**Files:**
- Modify: `src/channels/telegram/index.ts` — add pairing flow
- Create: `src/channels/telegram/pairing.ts`
- Create: `src/channels/telegram/pairing.test.ts`

**Step 1: Write the failing test**

```typescript
// src/channels/telegram/pairing.test.ts
import { describe, it, expect } from "vitest";
import { PairingManager } from "./pairing.js";

describe("PairingManager", () => {
  it("generates a pairing code for unknown users", () => {
    const pm = new PairingManager(["owner-123"]);
    const code = pm.requestPairing("unknown-456");
    expect(code).toMatch(/^\d{6}$/);
  });

  it("allows known users without pairing", () => {
    const pm = new PairingManager(["owner-123"]);
    expect(pm.isAuthorized("owner-123")).toBe(true);
  });

  it("blocks unknown users until pairing complete", () => {
    const pm = new PairingManager(["owner-123"]);
    expect(pm.isAuthorized("unknown-456")).toBe(false);
  });

  it("authorizes after correct pairing code", () => {
    const pm = new PairingManager(["owner-123"]);
    const code = pm.requestPairing("new-user");
    const success = pm.completePairing("new-user", code);
    expect(success).toBe(true);
    expect(pm.isAuthorized("new-user")).toBe(true);
  });

  it("rejects wrong pairing code", () => {
    const pm = new PairingManager(["owner-123"]);
    pm.requestPairing("new-user");
    const success = pm.completePairing("new-user", "000000");
    expect(success).toBe(false);
    expect(pm.isAuthorized("new-user")).toBe(false);
  });

  it("allows all users when allowedUsers is empty", () => {
    const pm = new PairingManager([]);
    expect(pm.isAuthorized("anyone")).toBe(true);
  });
});
```

**Step 2: Run test, implement, run test**

```typescript
// src/channels/telegram/pairing.ts
import { randomInt } from "node:crypto";

export class PairingManager {
  private pendingCodes = new Map<string, string>();
  private pairedUsers = new Set<string>();

  constructor(private allowedUsers: string[]) {
    // Pre-authorize configured users
    for (const u of allowedUsers) this.pairedUsers.add(u);
  }

  isAuthorized(userId: string): boolean {
    if (this.allowedUsers.length === 0) return true;
    return this.pairedUsers.has(userId);
  }

  requestPairing(userId: string): string {
    const code = String(randomInt(100000, 999999));
    this.pendingCodes.set(userId, code);
    return code;
  }

  completePairing(userId: string, code: string): boolean {
    const expected = this.pendingCodes.get(userId);
    if (!expected || expected !== code) return false;
    this.pairedUsers.add(userId);
    this.pendingCodes.delete(userId);
    return true;
  }
}
```

Then modify `src/channels/telegram/index.ts`:
- Replace `isAllowedUser` with `PairingManager`
- Unknown users get: "Send the pairing code to access NixClaw" + the code is logged server-side
- When user sends just a 6-digit number, check against `completePairing`

**Step 3: Commit**

```bash
cd ~/nixclaw
git add src/channels/telegram/pairing.ts src/channels/telegram/pairing.test.ts src/channels/telegram/index.ts
git commit -m "feat: add Telegram DM pairing — unknown users must enter pairing code"
```

---

## Integration: Wire Everything into index.ts

### Task 13: Integration Wiring

**Files:**
- Modify: `src/index.ts` — register ObservePlugin, HeartbeatPlugin
- Modify: `src/core/config.ts` — add new config fields (workspaceDir, observe, security)
- Modify: `nix/module.nix` — add new NixOS options

**Step 1: Update config**

Add to `NixClawConfig`:
```typescript
workspaceDir: string;
observe: { enable: boolean; allowedReadPaths: string[] };
security: {
  policies: ToolPolicy[];
  approvalTimeoutSeconds: number;
};
```

**Step 2: Update index.ts**

Add imports and conditional registration for:
- `ObservePlugin` (from `./tools/observe/index.js`)
- `HeartbeatPlugin` (from `./tools/heartbeat/index.js`)

Pass `workspaceDir` via config to HeartbeatPlugin.

**Step 3: Update NixOS module**

Add options:
- `services.nixclaw.workspaceDir` — defaults to `/var/lib/nixclaw/workspace`
- `services.nixclaw.observe.enable` — defaults to `true`
- `services.nixclaw.observe.allowedReadPaths` — list of paths
- `services.nixclaw.security.policies` — tool policy list

**Step 4: Run full tests**

Run: `cd ~/nixclaw && npx vitest run`
Expected: All tests pass

**Step 5: Commit**

```bash
cd ~/nixclaw
git add src/index.ts src/core/config.ts nix/module.nix
git commit -m "feat: wire Phase 2 plugins — observe, heartbeat, security into main entry point"
```

---

## Final: Update Nix Build

### Task 14: Update npmDepsHash

**Step 1: Run `nix build`**

Run: `cd ~/nixclaw && nix build 2>&1`

If it fails with hash mismatch, update `npmDepsHash` in `flake.nix` with the correct hash from the error output.

**Step 2: Verify build**

Run: `cd ~/nixclaw && ls -la result/bin/nixclaw`
Expected: binary exists

**Step 3: Commit**

```bash
cd ~/nixclaw
git add flake.nix
git commit -m "chore: update npmDepsHash for Phase 2 dependencies"
```

---

## Summary

| Task | Pillar | New Files | New Tests |
|------|--------|-----------|-----------|
| 1 | Observation | `tools/observe/safe-exec.ts` | 5 |
| 2 | Observation | `tools/observe/index.ts` | 2 |
| 3 | Personality | `core/personality.ts` | 4 |
| 4 | Heartbeat | `tools/heartbeat/index.ts` | 2 |
| 5 | Security | `core/tool-policy.ts` | 5 |
| 6 | Approval | `core/approval.ts` | 4 |
| 7 | Approval | `telegram/approval.ts` | 4 |
| 8 | Approval | `scripts/nixclaw-hook.sh` | 0 |
| 9 | NixOS | `tools/nixos/generations.ts` | 2 |
| 10 | NixOS | (modify existing) | 0 |
| 11 | Sessions | (modify existing) | 3 |
| 12 | DM Pairing | `telegram/pairing.ts` | 5 |
| 13 | Integration | (modify existing) | 0 |
| 14 | Nix Build | (modify flake) | 0 |

**Estimated new tests: ~36** (on top of existing 45 = ~81 total)
