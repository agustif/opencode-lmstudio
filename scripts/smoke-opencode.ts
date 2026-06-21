#!/usr/bin/env bun

import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createLMStudioFixture } from "../test/fixtures/lmstudio-server.ts"
import { expectedVersionForPackageSpec, installTestPackage } from "./install-test-package.ts"

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk })
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk })
    child.once("error", reject)
    child.once("close", (code) => resolveRun({ code: code ?? 1, stdout, stderr }))
  })
}

const root = mkdtempSync(join(tmpdir(), "opencode-lmstudio-smoke-"))
const fixture = await createLMStudioFixture("smoke", "smoke-token", "SMOKE_OK")
try {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  const packageFlag = process.argv.indexOf("--package")
  const packageSpec = packageFlag === -1 ? undefined : process.argv[packageFlag + 1]
  if (packageFlag !== -1 && !packageSpec) throw new Error("--package requires a value")
  const expectedFlag = process.argv.indexOf("--expected-version")
  const explicitVersion = expectedFlag === -1 ? undefined : process.argv[expectedFlag + 1]
  if (expectedFlag !== -1 && !explicitVersion) throw new Error("--expected-version requires a value")
  const installed = packageSpec
    ? installTestPackage(
      packageSpec,
      expectedVersionForPackageSpec(packageSpec, explicitVersion),
      join(root, "package"),
    )
    : undefined
  const pluginEntry = installed?.entrypoint ?? join(repoRoot, "dist", "index.js")
  const pluginDirectory = join(root, ".opencode", "plugins")
  mkdirSync(pluginDirectory, { recursive: true })
  mkdirSync(join(root, "home"), { recursive: true })
  mkdirSync(join(root, "xdg", "config"), { recursive: true })
  mkdirSync(join(root, "xdg", "cache"), { recursive: true })
  mkdirSync(join(root, "xdg", "data"), { recursive: true })
  mkdirSync(join(root, "xdg", "state"), { recursive: true })

  writeFileSync(join(pluginDirectory, "lmstudio.ts"),
    `export { LMStudioPlugin } from ${JSON.stringify(pluginEntry)}\n`)
  const configPath = join(root, "opencode.json")
  writeFileSync(configPath, JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    model: `lmstudio/${fixture.modelIDs.llm}`,
    provider: {
      lmstudio: {
        npm: "@ai-sdk/openai-compatible",
        name: "LM Studio Smoke",
        options: {
          baseURL: `${fixture.serverURL}/v1`,
          apiKey: "smoke-token",
        },
      },
    },
  }, null, 2))

  const env = {
    ...process.env,
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "xdg", "config"),
    XDG_CACHE_HOME: join(root, "xdg", "cache"),
    XDG_DATA_HOME: join(root, "xdg", "data"),
    XDG_STATE_HOME: join(root, "xdg", "state"),
    OPENCODE_CONFIG: configPath,
    OPENCODE_CONFIG_DIR: join(root, ".opencode"),
  }
  const opencode = process.env.OPENCODE_BIN ?? "opencode"

  const resolved = await run(opencode, ["debug", "config"], root, env)
  assert.equal(resolved.code, 0, resolved.stderr)
  const parsed = JSON.parse(resolved.stdout) as {
    provider?: { lmstudio?: { models?: Record<string, unknown>; whitelist?: string[] } }
  }
  const provider = parsed.provider?.lmstudio
  assert(provider)
  assert.deepEqual(Object.keys(provider.models ?? {}), [fixture.modelIDs.llm, fixture.modelIDs.vlm])
  assert.deepEqual(provider.whitelist, [fixture.modelIDs.llm, fixture.modelIDs.vlm])
  assert.equal((provider.models?.[fixture.modelIDs.vlm] as { attachment?: boolean }).attachment, true)

  const live = await run(opencode, ["run", "--model", `lmstudio/${fixture.modelIDs.llm}`, "SMOKE_PROMPT"], root, env)
  assert.equal(live.code, 0, live.stderr)
  assert(fixture.requests.some((request) => request.method === "GET" && request.url === "/api/v0/models"))
  assert(fixture.requests.some((request) => request.method === "POST" && request.url === "/v1/chat/completions"))
  assert(fixture.requests.every((request) => request.authorization === "Bearer smoke-token"))

  const source = installed ? `${installed.source} package ${installed.version}` : "local build"
  console.log(`OpenCode live smoke passed with ${source}: plugin load, typed discovery, filtering, auth, and chat request flow`)
} finally {
  await fixture.close()
  rmSync(root, { recursive: true, force: true })
}
