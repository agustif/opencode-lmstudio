import { ToastNotifier } from '../ui/toast-notifier'
import { validateConfig } from '../utils/validation'
import { enhanceConfig, isLMStudioProviderKey } from './enhance-config'
import type { PluginInput } from '@opencode-ai/plugin'

export function createConfigHook(client: PluginInput['client'], toastNotifier: ToastNotifier) {
  return async (config: any) => {
    // Check if config is modifiable
    if (config && (Object.isFrozen?.(config) || Object.isSealed?.(config))) {
      console.warn("[opencode-lmstudio] Config object is frozen/sealed - cannot modify directly")
      return
    }

    const validation = validateConfig(config)
    if (!validation.isValid) {
      console.error("[opencode-lmstudio] Invalid config provided:", validation.errors)
      // Don't await toast - don't block startup
      toastNotifier.error("Plugin configuration is invalid", "Configuration Error").catch(() => {})
      return
    }

    if (validation.warnings.length > 0) {
      console.warn("[opencode-lmstudio] Config warnings:", validation.warnings)
    }

    // If no LM Studio providers are configured, do a quick check on the default port
    // so we can pre-create the provider before the full enhanceConfig runs
    const hasLMStudioProvider = config.provider &&
      Object.keys(config.provider).some(key => isLMStudioProviderKey(key))

    if (!hasLMStudioProvider) {
      try {
        const response = await fetch("http://127.0.0.1:1234/v1/models", {
          method: "GET",
          signal: AbortSignal.timeout(1000),
        })
        if (response.ok) {
          if (!config.provider) config.provider = {}
          config.provider.lmstudio = {
            npm: "@ai-sdk/openai-compatible",
            name: "LM Studio (local)",
            options: { baseURL: "http://127.0.0.1:1234/v1" },
            models: {},
          }
        }
      } catch {
        // Ignore - will be handled by full enhanceConfig
      }
    }

    // Wait for model discovery across all LM Studio providers (max 5 seconds)
    try {
      await Promise.race([
        enhanceConfig(config, client, toastNotifier),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ])
    } catch (error) {
      console.error("[opencode-lmstudio] Config enhancement failed:", error)
      console.error("[opencode-lmstudio:DEBUG] Error stack:", error instanceof Error ? error.stack : String(error))
    }

    // Report total models loaded across all LM Studio providers
    const totalModels = config.provider
      ? Object.entries(config.provider)
          .filter(([key]) => isLMStudioProviderKey(key))
          .reduce((sum, [, p]: [string, any]) => sum + Object.keys(p?.models ?? {}).length, 0)
      : 0

    if (totalModels === 0 && hasLMStudioProvider) {
      console.warn("[opencode-lmstudio] No models discovered - LM Studio might be offline")
    } else if (totalModels > 0) {
      console.log(`[opencode-lmstudio] Loaded ${totalModels} models`)
    }
  }
}

