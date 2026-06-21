#!/usr/bin/env bun

import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { expectedVersionForPackageSpec, installTestPackage } from "./install-test-package.ts"

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`)
  return value
}

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

const packageSpec = argumentValue("--package")
const packageVersion = packageSpec
  ? expectedVersionForPackageSpec(packageSpec, argumentValue("--expected-version"))
  : undefined
const packageRoot = packageSpec ? mkdtempSync(join(tmpdir(), "opencode-lmstudio-package-")) : undefined

try {
  const installed = packageSpec && packageVersion && packageRoot
    ? installTestPackage(packageSpec, packageVersion, packageRoot)
    : undefined
  const providerName = installed
    ? `LM Studio ${installed.source}`
    : "LM Studio TUI Test"
  const args = ["@microsoft/tui-test"]
  if (process.argv.includes("--update")) args.push("--updateSnapshot")
  const result = spawnSync("bunx", args, {
    env: {
      ...process.env,
      OPENCODE_BIN: opencodeBinary,
      ...(installed ? {
        OPENCODE_LMSTUDIO_EXPECTED_VERSION: installed.version,
        OPENCODE_LMSTUDIO_PLUGIN_ENTRY: installed.entrypoint,
        OPENCODE_LMSTUDIO_PROVIDER_NAME: providerName,
        OPENCODE_LMSTUDIO_TEST_SOURCE: installed.source,
      } : {}),
    },
    stdio: "inherit",
  })
  process.exitCode = result.status ?? 1
} finally {
  if (packageRoot) rmSync(packageRoot, { recursive: true, force: true })
}
