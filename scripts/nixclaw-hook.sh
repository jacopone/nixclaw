#!/usr/bin/env bash
# scripts/nixclaw-hook.sh — Claude Code PreToolUse hook
# Sends approval request to NixClaw, waits for Telegram response
#
# Usage in Claude Code settings (.claude/settings.json):
#   "hooks": {
#     "PreToolUse": [{
#       "matcher": "Bash|Write",
#       "command": "/path/to/nixclaw-hook.sh"
#     }]
#   }
#
# Environment variables:
#   NIXCLAW_URL                 — NixClaw WebUI base URL (default: http://localhost:3344)
#   NIXCLAW_APPROVAL_TIMEOUT    — Max seconds to wait (default: 300)
#   CLAUDE_TOOL                 — Tool name (set by Claude Code)
#   CLAUDE_INPUT                — Tool input (set by Claude Code)
#   CLAUDE_SESSION              — Session identifier (set by Claude Code)
set -euo pipefail

if ! command -v jq &> /dev/null; then
  echo '{"decision": "deny"}'
  exit 0
fi

NIXCLAW_URL="${NIXCLAW_URL:-http://localhost:3344}"
TIMEOUT="${NIXCLAW_APPROVAL_TIMEOUT:-300}"
TOOL="${CLAUDE_TOOL:-unknown}"
INPUT="${CLAUDE_INPUT:-}"
SESSION="${CLAUDE_SESSION:-unknown}"

# Request approval
RESPONSE=$(curl -sf -X POST "$NIXCLAW_URL/api/approve" \
  -H 'Content-Type: application/json' \
  -d "{\"tool\":\"$TOOL\",\"input\":$(echo "$INPUT" | head -c 500 | jq -Rs .),\"session\":\"$SESSION\",\"requester\":\"claude-code\"}" 2>/dev/null) || {
  echo '{"decision": "deny"}'
  exit 0
}

REQUEST_ID=$(echo "$RESPONSE" | jq -r '.id')

if [ -z "$REQUEST_ID" ] || [ "$REQUEST_ID" = "null" ]; then
  echo '{"decision": "deny"}'
  exit 0
fi

# Poll for decision
for i in $(seq 1 "$TIMEOUT"); do
  STATUS=$(curl -sf "$NIXCLAW_URL/api/approve/$REQUEST_ID" 2>/dev/null || echo '{}')
  DECISION=$(echo "$STATUS" | jq -r '.status // "pending"')

  if [ "$DECISION" = "allow" ] || [ "$DECISION" = "deny" ]; then
    echo "{\"decision\": \"$DECISION\"}"
    exit 0
  fi

  sleep 1
done

# Timeout — default deny (fail-closed)
echo '{"decision": "deny"}'
