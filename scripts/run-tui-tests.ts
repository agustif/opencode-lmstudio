#!/usr/bin/env bun

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const expectedVersion = readFileSync(".opencode-tui-version", "utf8").trim()
const candidates = [
  process.env.OPENCODE_BIN,
  "/opt/homebrew/bin/opencode",
  join(homedir(), ".opencode", "bin", "opencode"),
].filter((value): value is string => Boolean(value && existsSync(value)))

const opencodeBinary = candidates.find((candidate) => {
  const result = spawnSync(candidate, ["--version"], { encoding: "utf8" })
  return result.status === 0 && result.stdout.trim() === expectedVersion
})

if (!opencodeBinary) {
  process.stderr.write(
    `Microsoft TUI Test requires the pinned OpenCode ${expectedVersion} compatibility binary. ` +
    "Set OPENCODE_BIN to that executable. Latest OpenCode is tested separately by smoke:opencode.\n",
  )
  process.exit(1)
}

const args = ["@microsoft/tui-test"]
if (process.argv.includes("--update")) args.push("--updateSnapshot")
const result = spawnSync("bunx", args, {
  env: { ...process.env, OPENCODE_BIN: opencodeBinary },
  stdio: "inherit",
})
process.exit(result.status ?? 1)
