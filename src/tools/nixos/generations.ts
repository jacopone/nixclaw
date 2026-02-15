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
    output
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => p.split("/").filter(Boolean).pop() ?? "")
      .filter((p) => p && !p.startsWith(".")),
  );
}

export async function diffGenerations(gen1: number, gen2: number): Promise<string> {
  const [closure1, closure2] = await Promise.all([
    getGenerationClosure(gen1),
    getGenerationClosure(gen2),
  ]);

  const diff = diffGenerationPaths(closure1, closure2);

  const lines: string[] = [`Generation ${gen1} \u2192 ${gen2}:`];
  if (diff.added.length > 0)
    lines.push(`\nAdded (${diff.added.length}):\n  ${diff.added.join("\n  ")}`);
  if (diff.removed.length > 0)
    lines.push(`\nRemoved (${diff.removed.length}):\n  ${diff.removed.join("\n  ")}`);
  if (diff.changed.length > 0) {
    lines.push(`\nChanged (${diff.changed.length}):`);
    for (const c of diff.changed) lines.push(`  ${c.pkg}: ${c.from} \u2192 ${c.to}`);
  }
  if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
    lines.push("  No package changes detected.");
  }

  return lines.join("\n");
}
