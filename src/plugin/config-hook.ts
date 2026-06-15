import type { Hooks } from "@opencode-ai/plugin"
import type { PluginLogger } from "../types/index.ts"
import { enhanceConfig } from "./enhance-config.ts"

export function createConfigHook(log: PluginLogger): NonNullable<Hooks["config"]> {
  return async (config) => {
    await enhanceConfig(config, log)
  }
}
