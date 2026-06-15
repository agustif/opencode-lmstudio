#!/usr/bin/env bun

/** Validate configuration with OpenCode's own current parser and schema. */
import { spawnSync } from "node:child_process"
import { dirname, resolve } from "node:path"

const requested = process.argv[2]
const configPath = requested ? resolve(requested) : undefined
const command = process.env.OPENCODE_BIN ?? "opencode"

const result = spawnSync(command, ["debug", "config"], {
  cwd: configPath ? dirname(configPath) : process.cwd(),
  env: {
    ...process.env,
    ...(configPath ? { OPENCODE_CONFIG: configPath } : {}),
  },
  stdio: "inherit",
})

if (result.error) {
  console.error(`Could not run ${command}:`, result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)
