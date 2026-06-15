#!/usr/bin/env bun

/**
 * Release preflight only.
 *
 * This command intentionally never changes versions, commits, tags, pushes,
 * creates GitHub releases, or publishes packages. Those actions require an
 * explicit reviewed release plan.
 */
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

function run(command: string, args: string[]): void {
  console.log(`\n> ${command} ${args.join(" ")}`)
  const result = spawnSync(command, args, { stdio: "inherit" })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { name: string; version: string }

console.log(`Release preflight for ${pkg.name}@${pkg.version}`)
run("npm", ["run", "validate"])
run("npm", ["run", "test:coverage"])
run("npm", ["audit", "--audit-level=high"])
run("npm", ["pack", "--dry-run"])

console.log("\nCore release preflight passed.")
console.log("The current-OpenCode smoke and pinned TUI/screenshot checks remain separate versioned gates in CI.")
console.log("No release action was performed. Review RELEASE.md before any version, tag, push, GitHub release, or npm publish action.")
