import type { Plugin, PluginInput } from "@opencode-ai/plugin"
import { createRequire } from "node:module"
import { ToastNotifier } from '../ui/toast-notifier.ts'
import { createConfigHook } from './config-hook.ts'
import { createEventHook } from './event-hook.ts'
import { createChatParamsHook } from './chat-params-hook.ts'

const nodeRequire = createRequire(import.meta.url)

function getPackageVersion(): string {
  try {
    const packageJSON = nodeRequire("../../package.json") as { version?: unknown }
    return typeof packageJSON.version === "string" ? packageJSON.version : "unknown"
  } catch {
    return "unknown"
  }
}

/**
 * LM Studio Plugin - Enhanced Modular Version
 * 
 * Features:
 * - Auto-detection of running LM Studio instance
 * - Dynamic model discovery from LM Studio API
 * - Real-time model validation with smart error handling
 * - Comprehensive caching system with 80%+ API call reduction
 * - Model loading state monitoring with progress tracking
 * - Toast notifications for better UX
 * - Intelligent model suggestions and error recovery
 */
export const LMStudioPlugin: Plugin = async (input: PluginInput) => {
  console.log("[opencode-lmstudio] LM Studio plugin initialized", {
    version: getPackageVersion(),
  })
  
  const { client } = input
  
  // Validate client
  if (!client || typeof client !== 'object') {
    console.error("[opencode-lmstudio] Invalid client provided to plugin")
    return {
      config: async () => {},
      event: async () => {},
      "chat.params": async () => {}
    }
  }
  
  const toastNotifier = new ToastNotifier(client)

  return {
    config: createConfigHook(client, toastNotifier),
    event: createEventHook(),
    "chat.params": createChatParamsHook(toastNotifier),
  }
}
