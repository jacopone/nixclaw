# nixclaw

MCP-native personal AI agent platform for NixOS.

## What it does

A multi-channel AI agent that integrates with NixOS system management. Connects via terminal, Telegram, and web UI. Uses a plugin architecture for tools (NixOS operations, scheduling, observability, dev helpers) and supports MCP servers as external tool providers. Packaged as a NixOS module for declarative deployment.

## Quick start

```bash
# Enter dev environment
nix develop

# Install dependencies
npm install

# Build
npm run build

# Run
npm start

# Development mode with hot reload
npm run dev
```

## Project structure

- `src/channels/` -- Terminal, Telegram, and web UI frontends
- `src/tools/` -- Plugin modules (NixOS, scheduler, observe, dev, heartbeat)
- `src/core/` -- Agent runtime, event bus, state store, plugin host, MCP client
- `src/ai/` -- Claude API integration
- `nix/` -- NixOS module for system-level deployment
- `flake.nix` -- Nix package and dev shell

## Tech stack

- TypeScript, Node.js 22
- Anthropic Claude SDK (AI backbone)
- MCP SDK (tool protocol)
- grammY (Telegram bot)
- Fastify (web UI server)
- better-sqlite3 (state persistence)
- Zod (schema validation)
- Nix flake + NixOS module
