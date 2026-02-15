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
  "nix", "nix-store", "nixos-option", "nixos-version", "nixos-rebuild",
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
  /-exec\b/, // find -exec can run arbitrary commands
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
