import { ModelStatusCache } from '../cache/model-status-cache'
import { ToastNotifier } from '../ui/toast-notifier'
import { categorizeModel, formatModelName, extractModelOwner } from '../utils'
import { normalizeBaseURL, checkLMStudioHealth, discoverLMStudioModels, autoDetectLMStudio } from '../utils/lmstudio-api'
import type { PluginInput } from '@opencode-ai/plugin'
import type { LMStudioModel } from '../types'

const modelStatusCache = new ModelStatusCache()

// Match any provider key that looks like an LM Studio instance:
// lmstudio, lm-studio, lmstudio-remote, lm-studio-workstation, etc.
const LM_STUDIO_KEY_RE = /^lm.?studio/i

export function isLMStudioProviderKey(key: string): boolean {
  return LM_STUDIO_KEY_RE.test(key)
}

// Return all [key, provider] pairs in config that look like LM Studio providers
function findLMStudioProviders(config: any): [string, any][] {
  if (!config.provider || typeof config.provider !== 'object') return []
  return Object.entries(config.provider).filter(([key]) => isLMStudioProviderKey(key))
}

// Discover models from a single host and merge them into the named provider in config
async function processHost(
  config: any,
  providerKey: string,
  baseURL: string,
): Promise<void> {
  const provider = config.provider?.[providerKey]
  if (!provider) return

  const isHealthy = await checkLMStudioHealth(baseURL)
  if (!isHealthy) {
    console.warn("[opencode-lmstudio] LM Studio appears to be offline", { baseURL })
    return
  }

  let models: LMStudioModel[]
  try {
    models = await discoverLMStudioModels(baseURL)
  } catch (error) {
    console.warn("[opencode-lmstudio] Model discovery failed", {
      baseURL,
      error: error instanceof Error ? error.message : String(error),
    })
    return
  }

  if (models.length === 0) {
    console.warn("[opencode-lmstudio] No models found in LM Studio. Please:", {
      baseURL,
      steps: [
        "1. Open LM Studio application",
        "2. Download and load a model",
        "3. Start the server",
      ],
    })
    return
  }

  const existingModels = provider.models || {}
  const discoveredModels: Record<string, any> = {}
  let chatModelsCount = 0
  let embeddingModelsCount = 0

  for (const model of models) {
    let modelKey = model.id
    if (!/^[a-zA-Z0-9_-]+$/.test(modelKey)) {
      modelKey = model.id.replace(/[^a-zA-Z0-9_-]/g, "_")
    }

    if (!existingModels[modelKey] && !existingModels[model.id]) {
      // Prefer API-provided type over name-based heuristic
      const isEmbedding = model.type === 'embeddings' || categorizeModel(model.id) === 'embedding'
      const owner = model.publisher || extractModelOwner(model.id)
      const contextLength = model.loaded_context_length ?? model.max_context_length

      const modelConfig: any = {
        id: model.id,
        name: formatModelName(model),
      }

      if (owner) {
        modelConfig.organizationOwner = owner
      }

      if (contextLength) {
        modelConfig.limit = {
          context: contextLength,
          // LM Studio doesn't expose a max output token limit, so estimate as 25% of context
          output: Math.floor(contextLength * 0.25),
        }
      }

      if (isEmbedding) {
        embeddingModelsCount++
        modelConfig.modalities = { input: ["text"], output: ["embedding"] }
      } else {
        chatModelsCount++
        modelConfig.modalities = { input: ["text", "image"], output: ["text"] }
        if (model.capabilities?.includes('tool_use')) {
          modelConfig.tool_call = true
        }
      }

      discoveredModels[modelKey] = modelConfig
    }
  }

  if (Object.keys(discoveredModels).length > 0) {
    config.provider[providerKey].models = {
      ...existingModels,
      ...discoveredModels,
    }

    if (chatModelsCount === 0 && embeddingModelsCount > 0) {
      console.warn("[opencode-lmstudio] Only embedding models found. To use chat models:", {
        baseURL,
        steps: [
          "1. Open LM Studio application",
          "2. Download a chat model (e.g., llama-3.2-3b-instruct)",
          "3. Load the model in LM Studio",
          "4. Ensure server is running",
        ],
      })
    }
  }

  // Warm up the cache with current model status
  try {
    await modelStatusCache.getModels(baseURL, async () => {
      return await discoverLMStudioModels(baseURL).then(m => m.map(x => x.id))
    })
  } catch {
    // Cache warming failed, not critical
  }
}

export async function enhanceConfig(
  config: any,
  _client: PluginInput['client'], // client not used but kept for interface compatibility
  toastNotifier: ToastNotifier
): Promise<void> {
  try {
    let lmstudioProviders = findLMStudioProviders(config)

    if (lmstudioProviders.length === 0) {
      // No LM Studio providers configured — try auto-detect
      const detectedURL = await autoDetectLMStudio()
      if (!detectedURL) {
        return // No LM Studio found
      }

      if (!config.provider) config.provider = {}
      config.provider.lmstudio = {
        npm: "@ai-sdk/openai-compatible",
        name: "LM Studio (local)",
        options: { baseURL: `${detectedURL}/v1` },
        models: {},
      }
      lmstudioProviders = [['lmstudio', config.provider.lmstudio]]
    }

    // Process all LM Studio providers in parallel
    const results = await Promise.allSettled(
      lmstudioProviders.map(([key, provider]) => {
        const baseURL = normalizeBaseURL(provider.options?.baseURL || "http://127.0.0.1:1234")
        return processHost(config, key, baseURL)
      })
    )

    // Log any unexpected rejections (processHost handles its own errors, so this is a safety net)
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const [key] = lmstudioProviders[index]
        console.error("[opencode-lmstudio] Unexpected error processing provider", {
          providerKey: key,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        })
      }
    })
  } catch (error) {
    console.error("[opencode-lmstudio] Unexpected error in enhanceConfig:", error)
    toastNotifier.warning("Plugin configuration failed", "Configuration Error").catch(() => {})
  }
}
