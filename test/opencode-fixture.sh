#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
fixture_root=$(mktemp -d "${TMPDIR:-/tmp}/opencode-lmstudio-tui.XXXXXX")
server_pid=""

cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$fixture_root"
}
trap cleanup EXIT HUP INT TERM

: "${OPENCODE_BIN:?OPENCODE_BIN must point to the pinned TUI-test OpenCode binary}"
mkdir -p "$fixture_root/.opencode/plugins" "$fixture_root/home" \
  "$fixture_root/xdg/config" "$fixture_root/xdg/cache" "$fixture_root/xdg/data" \
  "$fixture_root/xdg/state/opencode"
printf '%s\n' '{"tips_hidden":true}' >"$fixture_root/xdg/state/opencode/kv.json"

bun "$repo_root/test/opencode-fixture-server.ts" "$fixture_root" \
  >"$fixture_root/server.log" 2>&1 &
server_pid=$!
for _ in {1..200}; do
  [[ -s "$fixture_root/server-url" ]] && break
  kill -0 "$server_pid" 2>/dev/null || { cat "$fixture_root/server.log" >&2; exit 1; }
  sleep 0.05
done
[[ -s "$fixture_root/server-url" ]] || { echo "LM Studio fixture did not become ready" >&2; exit 1; }
server_url=$(<"$fixture_root/server-url")

cat >"$fixture_root/.opencode/plugins/lmstudio.ts" <<PLUGIN
export { LMStudioPlugin } from "$repo_root/dist/index.js"
PLUGIN
cat >"$fixture_root/opencode.json" <<CONFIG
{
  "\$schema": "https://opencode.ai/config.json",
  "autoupdate": false,
  "model": "lmstudio/qwen2.5-coder-7b-instruct",
  "provider": {
    "lmstudio": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LM Studio TUI Test",
      "options": {
        "baseURL": "$server_url/v1",
        "apiKey": "tui-token"
      }
    }
  }
}
CONFIG

export HOME="$fixture_root/home"
export XDG_CONFIG_HOME="$fixture_root/xdg/config"
export XDG_CACHE_HOME="$fixture_root/xdg/cache"
export XDG_DATA_HOME="$fixture_root/xdg/data"
export XDG_STATE_HOME="$fixture_root/xdg/state"
export OPENCODE_CONFIG="$fixture_root/opencode.json"
export OPENCODE_CONFIG_DIR="$fixture_root/.opencode"
export OPENCODE_DISABLE_AUTOUPDATE=true
cd "$fixture_root"
"$OPENCODE_BIN"
