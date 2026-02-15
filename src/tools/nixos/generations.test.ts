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
