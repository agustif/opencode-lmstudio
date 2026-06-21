#!/usr/bin/env bun

/** Read-only release preflight. Mutations run through the reviewed workflow. */
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { getReleaseVersionMetadata } from "./release-version.ts"

function run(command: string, args: string[]): void {
  console.log(`\n> ${command} ${args.join(" ")}`)
  const result = spawnSync(command, args, { stdio: "inherit" })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { name: string; version: string }
const release = getReleaseVersionMetadata(pkg.version)
const releaseNotes = `docs/releases/${release.gitTag}.md`
if (!existsSync(releaseNotes)) throw new Error(`Missing release notes: ${releaseNotes}`)

console.log(`Release preflight for ${pkg.name}@${pkg.version}`)
console.log(`Release channel: npm ${release.npmTag}; GitHub ${release.isPrerelease ? "prerelease" : "latest"}`)
run("npm", ["run", "validate"])
run("npm", ["run", "test:coverage"])
run("npm", ["audit", "--audit-level=high"])
run("npm", ["pack", "--dry-run"])

console.log("\nCore release preflight passed.")
console.log("The current-OpenCode smoke and pinned TUI/screenshot checks remain separate versioned gates in CI.")
console.log("Release mutations run through the reviewed workflow documented in RELEASE.md.")
