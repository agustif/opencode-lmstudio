#!/usr/bin/env bun

import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createLMStudioFixture } from "../test/fixtures/lmstudio-server.ts"
import { createNpmRegistryFixture, type NpmRegistryFixture } from "../test/fixtures/npm-registry-server.ts"
import { expectedVersionForPackageSpec } from "./install-test-package.ts"

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`)
  return value
}

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    const timeout = setTimeout(() => {
      child.kill("SIGTERM")
      reject(new Error(`${command} ${args.join(" ")} timed out`))
    }, 90_000)
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk })
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk })
    child.once("error", reject)
    child.once("close", (code) => {
      clearTimeout(timeout)
      resolveRun({ code: code ?? 1, stdout, stderr })
    })
  })
}

const tarball = argumentValue("--tarball")
const explicitVersion = argumentValue("--expected-version")
const packageSpec = tarball
  ? `opencode-lmstudio@${explicitVersion ?? ""}`
  : process.argv[2]
if (!packageSpec?.startsWith("opencode-lmstudio@") || packageSpec === "opencode-lmstudio@") {
  throw new Error("Pass opencode-lmstudio@<version>, or --tarball <path> --expected-version <version>")
}
const expectedVersion = expectedVersionForPackageSpec(packageSpec, explicitVersion)
const root = mkdtempSync(join(tmpdir(), "opencode-lmstudio-resolver-"))
const fixture = await createLMStudioFixture("resolver", "resolver-token", "RESOLVER_OK")
let registry: NpmRegistryFixture | undefined

try {
  registry = tarball ? await createNpmRegistryFixture(tarball) : undefined
  const home = join(root, "home")
  const xdg = join(root, "xdg")
  const npmrc = join(root, "anonymous.npmrc")
  mkdirSync(home, { recursive: true })
  mkdirSync(join(root, ".opencode"), { recursive: true })
  for (const directory of ["config", "cache", "data", "state"]) {
    mkdirSync(join(xdg, directory), { recursive: true })
  }
  writeFileSync(npmrc, `registry=${registry?.registryURL ?? "https://registry.npmjs.org"}\nalways-auth=false\n`)
  const configPath = join(root, "opencode.json")
  writeFileSync(configPath, JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    autoupdate: false,
    plugin: [packageSpec],
    model: `lmstudio/${fixture.modelIDs.text}`,
    provider: {
      lmstudio: {
        npm: "@ai-sdk/openai-compatible",
        name: "LM Studio Resolver Test",
        options: {
          baseURL: `${fixture.serverURL}/v1`,
          apiKey: "resolver-token",
        },
      },
    },
  }, null, 2))

  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      key !== "NODE_AUTH_TOKEN"
      && key !== "NPM_TOKEN"
      && !(key.toLowerCase().startsWith("npm_config_") && /(auth|token)/i.test(key))),
  )
  Object.assign(env, {
    HOME: home,
    XDG_CONFIG_HOME: join(xdg, "config"),
    XDG_CACHE_HOME: join(xdg, "cache"),
    XDG_DATA_HOME: join(xdg, "data"),
    XDG_STATE_HOME: join(xdg, "state"),
    NPM_CONFIG_USERCONFIG: npmrc,
    OPENCODE_CONFIG: configPath,
    OPENCODE_CONFIG_DIR: join(root, ".opencode"),
    OPENCODE_DISABLE_AUTOUPDATE: "true",
  })
  const opencode = process.env.OPENCODE_BIN ?? "opencode"

  const resolved = await run(opencode, ["debug", "config"], root, env)
  assert.equal(resolved.code, 0, resolved.stderr)
  const parsed = JSON.parse(resolved.stdout) as {
    plugin?: string[]
    plugin_origins?: Array<{ spec?: string }>
    provider?: { lmstudio?: { models?: Record<string, unknown>; whitelist?: string[] } }
  }
  assert(parsed.plugin?.includes(packageSpec))
  assert(parsed.plugin_origins?.some((origin) => origin.spec === packageSpec))
  assert.deepEqual(Object.keys(parsed.provider?.lmstudio?.models ?? {}), [
    fixture.modelIDs.text,
    fixture.modelIDs.vision,
  ])
  const resolvedModels = parsed.provider?.lmstudio?.models ?? {}
  assert.equal((resolvedModels[fixture.modelIDs.text] as { tool_call?: boolean }).tool_call, true)
  assert.equal((resolvedModels[fixture.modelIDs.vision] as { tool_call?: boolean }).tool_call, true)

  const packageManifest = join(
    xdg,
    "cache",
    "opencode",
    "packages",
    packageSpec,
    "node_modules",
    "opencode-lmstudio",
    "package.json",
  )
  const installed = JSON.parse(readFileSync(packageManifest, "utf8")) as { version?: string }
  assert.equal(installed.version, expectedVersion)

  const live = await run(
    opencode,
    ["run", "--model", `lmstudio/${fixture.modelIDs.text}`, "RESOLVER_PROMPT"],
    root,
    env,
  )
  assert.equal(live.code, 0, live.stderr)
  assert.match(live.stdout, /RESOLVER_OK/)
  assert(fixture.requests.some((request) => request.method === "GET" && request.url === "/api/v1/models"))
  assert(fixture.requests.some((request) => request.method === "POST" && request.url === "/v1/chat/completions"))
  assert(fixture.requests.every((request) => request.authorization === "Bearer resolver-token"))

  const source = tarball ? "isolated candidate registry" : "public npm registry"
  console.log(`OpenCode native npm resolver passed with ${packageSpec} from ${source} on ${await version(opencode, root, env)}`)
} finally {
  await registry?.close()
  await fixture.close()
  rmSync(root, { recursive: true, force: true })
}

async function version(command: string, cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  const result = await run(command, ["--version"], cwd, env)
  assert.equal(result.code, 0, result.stderr)
  return `OpenCode ${result.stdout.trim()}`
}
