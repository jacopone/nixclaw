import { describe, it, expect } from "vitest";
import { WebUIChannel } from "./index.js";

describe("WebUIChannel", () => {
  it("implements NixClawPlugin interface", () => {
    const channel = new WebUIChannel();
    expect(channel.name).toBe("webui");
    expect(channel.version).toBeDefined();
  });
});
