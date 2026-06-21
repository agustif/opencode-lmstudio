#!/usr/bin/env bun

import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { Readable, Writable } from "node:stream"
import { fileURLToPath } from "node:url"
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Client,
} from "@agentclientprotocol/sdk"
import { createLMStudioFixture } from "../test/fixtures/lmstudio-server.ts"
import { expectedVersionForPackageSpec, installTestPackage } from "./install-test-package.ts"

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`)
  return value
}

async function readRaw(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let value = ""
  while (true) {
    const next = await reader.read()
    if (next.done) return value + decoder.decode()
    value += decoder.decode(next.value, { stream: true })
  }
}

function waitForExit(child: ReturnType<typeof spawn>): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolveExit, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error("OpenCode ACP did not exit after stdin closed"))
    }, 15_000)
    child.once("error", reject)
    child.once("close", (code, signal) => {
      clearTimeout(timeout)
      resolveExit({ code, signal })
    })
  })
}

async function withTimeout<T>(operation: Promise<T>, name: string, timeoutMs = 60_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`OpenCode ACP ${name} timed out`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const root = mkdtempSync(join(tmpdir(), "opencode-lmstudio-acp-"))
const fixture = await createLMStudioFixture("acp", "acp-token")
let child: ReturnType<typeof spawn> | undefined

try {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  const packageSpec = argumentValue("--package")
  const expectedVersion = packageSpec
    ? expectedVersionForPackageSpec(packageSpec, argumentValue("--expected-version"))
    : undefined
  const directPackage = packageSpec?.startsWith("opencode-lmstudio@") === true
  const installed = packageSpec && expectedVersion && !directPackage
    ? installTestPackage(packageSpec, expectedVersion, join(root, "package"))
    : undefined
  const pluginEntry = installed?.entrypoint ?? join(repoRoot, "dist", "index.js")
  const pluginDirectory = join(root, ".opencode", "plugins")
  const home = join(root, "home")
  const xdg = join(root, "xdg")
  const npmrc = join(root, "anonymous.npmrc")
  mkdirSync(pluginDirectory, { recursive: true })
  mkdirSync(home, { recursive: true })
  for (const directory of ["config", "cache", "data", "state"]) {
    mkdirSync(join(xdg, directory), { recursive: true })
  }
  writeFileSync(npmrc, "registry=https://registry.npmjs.org\nalways-auth=false\n")
  if (!directPackage) {
    writeFileSync(
      join(pluginDirectory, "lmstudio.ts"),
      `export { LMStudioPlugin } from ${JSON.stringify(pluginEntry)}\n`,
    )
  }
  const configPath = join(root, "opencode.json")
  writeFileSync(configPath, JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    autoupdate: false,
    ...(directPackage ? { plugin: [packageSpec] } : {}),
    model: `lmstudio/${fixture.modelIDs.text}`,
    provider: {
      lmstudio: {
        npm: "@ai-sdk/openai-compatible",
        name: "LM Studio ACP Test",
        options: {
          baseURL: `${fixture.serverURL}/v1`,
          apiKey: "acp-token",
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
  child = spawn(opencode, ["acp", "--cwd", root], {
    cwd: root,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  })
  assert(child.stdin && child.stdout && child.stderr)
  let stderr = ""
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk })

  const output = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
  const [protocolOutput, auditOutput] = output.tee()
  const rawPromise = readRaw(auditOutput)
  const client: Client = {
    requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
    sessionUpdate: async () => undefined,
  }
  const connection = new ClientSideConnection(
    () => client,
    ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      protocolOutput,
    ),
  )

  const initialized = await withTimeout(connection.initialize({
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {},
  }), "initialize")
  assert.equal(initialized.protocolVersion, PROTOCOL_VERSION)
  const session = await withTimeout(
    connection.newSession({ cwd: root, mcpServers: [] }),
    "session/new",
  )
  assert(session.sessionId)

  child.stdin.end()
  const exit = await waitForExit(child)
  const raw = await rawPromise
  assert(exit.code === 0 || exit.signal === "SIGTERM", stderr)
  const lines = raw.split("\n").filter((line) => line.trim().length > 0)
  assert(lines.length >= 2, `Expected ACP responses, received: ${raw}`)
  for (const line of lines) {
    const message: unknown = JSON.parse(line)
    assert(message && typeof message === "object" && "jsonrpc" in message)
    assert.equal((message as { jsonrpc?: unknown }).jsonrpc, "2.0")
  }
  assert(!raw.includes("opencode-lmstudio"), "Plugin diagnostics leaked onto ACP stdout")
  assert(fixture.requests.some((request) => request.method === "GET" && request.url === "/api/v1/models"))

  const source = directPackage
    ? `OpenCode npm resolver package ${expectedVersion}`
    : installed
      ? `${installed.source} package ${installed.version}`
      : "local build"
  console.log(`OpenCode ACP initialize/new-session and JSON-RPC stdout purity passed with ${source}`)
} finally {
  child?.kill("SIGTERM")
  await fixture.close()
  rmSync(root, { recursive: true, force: true })
}
