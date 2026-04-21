import { ModelStatusCache } from '../cache/model-status-cache'
import { ToastNotifier } from '../ui/toast-notifier'
import { categorizeModel, formatModelName, extractModelOwner } from '../utils'
import { normalizeBaseURL, checkLMStudioHealth, discoverLMStudioModels, discoverLMStudioModelsV0, autoDetectLMStudio } from '../utils/lmstudio-api'
import type { PluginInput } from '@opencode-ai/plugin'
import type { LMStudioModel, LMStudioModelV0, ModelType } from '../types'

const MAX_OUTPUT_TOKENS_CAP = 16384

const modelStatusCache = new ModelStatusCache()

export async function enhanceConfig(
  config: any,
  _client: PluginInput['client'], // client not used but kept for interface compatibility
  toastNotifier: ToastNotifier
): Promise<void> {
  try {
    let lmstudioProvider = config.provider?.lmstudio
    let baseURL: string

    // If lmstudio provider exists, use its baseURL
    if (lmstudioProvider) {
      baseURL = normalizeBaseURL(lmstudioProvider.options?.baseURL || "http://127.0.0.1:1234")
    } else {
      // Try to auto-detect LM Studio
      const detectedURL = await autoDetectLMStudio()
      if (!detectedURL) {
        return // No LM Studio found
      }
      
      // Auto-create lmstudio provider if detected
      baseURL = detectedURL
      if (!config.provider) {
        config.provider = {}
      }
      config.provider.lmstudio = {
        npm: "@ai-sdk/openai-compatible",
        name: "LM Studio (local)",
        options: {
          baseURL: `${baseURL}/v1`,
        },
        models: {},
      }
      lmstudioProvider = config.provider.lmstudio
    }

    // Check health first
    const isHealthy = await checkLMStudioHealth(baseURL)
    if (!isHealthy) {
      console.warn("[opencode-lmstudio] LM Studio appears to be offline", { baseURL })
      return
    }

    // Try /api/v0/models first (exposes context length) then fall back to /v1/models
    let models: Array<LMStudioModel | LMStudioModelV0> = []
    let usedV0 = false
    try {
      const v0Models = await discoverLMStudioModelsV0(baseURL)
      if (v0Models !== null) {
        models = v0Models
        usedV0 = true
      } else {
        console.warn("[opencode-lmstudio] /api/v0/models unavailable (LMStudio < 0.3.5?), falling back to /v1/models — context length discovery disabled")
        models = await discoverLMStudioModels(baseURL)
      }
    } catch (error) {
      try {
        models = await discoverLMStudioModels(baseURL)
      } catch (fallbackError) {
        console.warn("[opencode-lmstudio] Model discovery failed", {
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        })
        return
      }
    }
    
    if (models.length > 0) {
      // Merge discovered models with configured models
      const existingModels = lmstudioProvider.models || {}
      const discoveredModels: Record<string, any> = {}
      let chatModelsCount = 0
      let embeddingModelsCount = 0

      for (const model of models) {
        // Use model ID as key directly for better readability, fallback to sanitized version
        let modelKey = model.id
        if (!/^[a-zA-Z0-9_-]+$/.test(modelKey)) {
          modelKey = model.id.replace(/[^a-zA-Z0-9_-]/g, "_")
        }

        // Only add if not already configured
        if (!existingModels[modelKey] && !existingModels[model.id]) {
          const v0Model = usedV0 ? (model as LMStudioModelV0) : null
          const modelType: ModelType = v0Model
            ? (v0Model.type === 'embeddings' ? 'embedding' : 'chat')
            : categorizeModel(model.id)
          const owner = v0Model?.publisher || extractModelOwner(model.id)
          const modelConfig: any = {
            id: model.id,
            name: formatModelName(model as LMStudioModel),
          }

          // Add owner if available
          if (owner) {
            modelConfig.organizationOwner = owner
          }

          // Add additional metadata based on model type
          if (modelType === 'embedding') {
            embeddingModelsCount++
            modelConfig.modalities = {
              input: ["text"],
              output: ["embedding"]
            }
          } else if (modelType === 'chat') {
            chatModelsCount++
            modelConfig.modalities = {
              input: ["text", "image"],
              output: ["text"]
            }
          }

          // Prefer loaded_context_length (user-configured) over max_context_length (model ceiling)
          if (v0Model) {
            const contextLength = v0Model.loaded_context_length ?? v0Model.max_context_length
            if (contextLength && contextLength > 0) {
              modelConfig.limit = {
                context: contextLength,
                output: Math.min(Math.floor(contextLength / 4), MAX_OUTPUT_TOKENS_CAP)
              }
            }
          }

          discoveredModels[modelKey] = modelConfig
        }
      }

      // Merge discovered models into config
      if (Object.keys(discoveredModels).length > 0) {
        if (!config.provider.lmstudio) {
          return
        }
        
        config.provider.lmstudio.models = {
          ...existingModels,
          ...discoveredModels,
        }

        // Provide helpful guidance if no chat models are available
        if (chatModelsCount === 0 && embeddingModelsCount > 0) {
          console.warn("[opencode-lmstudio] Only embedding models found. To use chat models:", {
            steps: [
              "1. Open LM Studio application",
              "2. Download a chat model (e.g., llama-3.2-3b-instruct)",
              "3. Load the model in LM Studio",
              "4. Ensure server is running"
            ]
          })
        }
      }
    } else {
      console.warn("[opencode-lmstudio] No models found in LM Studio. Please:", {
        steps: [
          "1. Open LM Studio application",
          "2. Download and load a model",
          "3. Start the server"
        ]
      })
    }
    
    // Warm up the cache with current model status
    try {
      await modelStatusCache.getModels(baseURL, async () => {
        return await discoverLMStudioModels(baseURL).then(models => models.map(m => m.id))
      })
    } catch (error) {
      // Cache warming failed, but not critical
    }
  } catch (error) {
    console.error("[opencode-lmstudio] Unexpected error in enhanceConfig:", error)
    toastNotifier.warning("Plugin configuration failed", "Configuration Error").catch(() => {})
  }
}

