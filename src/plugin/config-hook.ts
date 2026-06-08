import { ToastNotifier } from '../ui/toast-notifier.ts'
import { validateConfig } from '../utils/validation/index.ts'
import { enhanceConfig } from './enhance-config.ts'
import { getLMStudioApiKey } from '../utils/lmstudio-api.ts'
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
    
    // Ensure provider exists and wait for initial model discovery
    // We wait with a timeout to ensure models are loaded before OpenCode reads the config
    if (!config.provider?.lmstudio) {
      // Quick check - try default port first with timeout
      try {
        const apiKey = getLMStudioApiKey(config.provider?.lmstudio?.options?.apiKey, "http://127.0.0.1:1234")

        const response = await fetch("http://127.0.0.1:1234/v1/models", {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          signal: AbortSignal.timeout(1000), // 1 second timeout for quick check
        })
        
        if (response.ok) {
          if (!config.provider) config.provider = {}
          if (!config.provider.lmstudio) {
            config.provider.lmstudio = {
              npm: "@ai-sdk/openai-compatible",
              name: "LM Studio (local)",
              options: {
                baseURL: "http://127.0.0.1:1234/v1",
                ...(apiKey ? { apiKey } : {}),
              },
              models: {},
            }
          }
        }
      } catch {
        // Ignore - will be handled by full enhanceConfig
      }
    }
    
    // Wait for initial model discovery with timeout (max 5 seconds)
    // This ensures models are available when OpenCode reads the config
    // We use Promise.race to avoid blocking too long, but we check if models were added
    const discoveryPromise = enhanceConfig(config, client, toastNotifier)
    const timeoutMs = 5000 // 5 second timeout
    
    try {
      await Promise.race([
        discoveryPromise,
        new Promise<void>((resolve) => {
          setTimeout(() => resolve(), timeoutMs)
        })
      ])
    } catch (error) {
      console.error("[opencode-lmstudio] Config enhancement failed:", error)
      console.error("[opencode-lmstudio:DEBUG] Error stack:", error instanceof Error ? error.stack : String(error))
    }
    
    const finalModelCount = config.provider?.lmstudio?.models ? Object.keys(config.provider.lmstudio.models).length : 0
    
    if (finalModelCount === 0 && config.provider?.lmstudio) {
      console.warn("[opencode-lmstudio] No models discovered - LM Studio might be offline")
    } else if (finalModelCount > 0) {
      console.log(`[opencode-lmstudio] Loaded ${finalModelCount} models`)
    }
  }
}
