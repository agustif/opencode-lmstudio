import type { Plugin, PluginInput } from "@opencode-ai/plugin"
import { createRequire } from "node:module"
import type { LogLevel, PluginLogger } from "../types/index.ts"
import { createConfigHook } from "./config-hook.ts"

const SERVICE = "opencode-lmstudio"
const nodeRequire = createRequire(import.meta.url)

function packageVersion(): string {
  try {
    const value = nodeRequire("../../package.json") as { version?: unknown }
    return typeof value.version === "string" ? value.version : "unknown"
  } catch {
    return "unknown"
  }
}

function createLogger(client: PluginInput["client"]): PluginLogger {
  return async (level: LogLevel, message: string, extra?: Record<string, unknown>) => {
    try {
      await client.app.log({
        body: {
          service: SERVICE,
          level,
          message,
          extra,
        },
      })
    } catch {
      // Logging must never block provider configuration.
    }
  }
}

export const LMStudioPlugin: Plugin = async ({ client }) => {
  const log = createLogger(client)
  await log("info", "LM Studio plugin initialized", { version: packageVersion() })
  return { config: createConfigHook(log) }
}
