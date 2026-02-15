import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export async function runCommand(cmd: string, args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await exec(cmd, args, { timeout: 30000 });
    return stdout + (stderr ? `\nSTDERR: ${stderr}` : "");
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    return `Error: ${e.message}\n${e.stdout ?? ""}\n${e.stderr ?? ""}`.trim();
  }
}

export async function getSystemStatus(): Promise<string> {
  const [generation, uptime, hostname] = await Promise.all([
    runCommand("nixos-rebuild", ["list-generations"]).catch(() => "unavailable"),
    runCommand("uptime", ["-p"]),
    runCommand("hostname", []),
  ]);
  return `Hostname: ${hostname.trim()}\nUptime: ${uptime.trim()}\nGenerations:\n${generation}`;
}

export async function flakeCheck(flakePath: string): Promise<string> {
  return runCommand("nix", ["flake", "check", flakePath, "--no-build"]);
}

export async function serviceStatus(serviceName: string): Promise<string> {
  return runCommand("systemctl", ["status", serviceName, "--no-pager"]);
}

export async function listServices(): Promise<string> {
  return runCommand("systemctl", [
    "list-units",
    "--type=service",
    "--state=running",
    "--no-pager",
    "--no-legend",
  ]);
}

export async function nixosOption(optionPath: string): Promise<string> {
  return runCommand("nixos-option", [optionPath]);
}
