import { ModelStatusCache } from '../cache/model-status-cache'
import { ToastNotifier } from '../ui/toast-notifier'
import { categorizeModel, formatModelName, extractModelOwner } from '../utils'
import { normalizeBaseURL, checkLMStudioHealth, discoverLMStudioModels, autoDetectLMStudio } from '../utils/lmstudio-api'
import type { PluginInput } from '@opencode-ai/plugin'
import type { LMStudioModel } from '../types'

const modelStatusCache = new ModelStatusCache()

function supportsVisionInput(model: LMStudioModel): boolean {
  if (typeof model.capabilities === 'object' && model.capabilities !== null && !Array.isArray(model.capabilities)) {
    return Boolean(model.capabilities.vision)
  }

  return model.type === 'vlm'
}

function supportsToolCall(model: LMStudioModel): boolean {
  if (Array.isArray(model.capabilities)) {
    return model.capabilities.includes('tool_use')
  }

  if (typeof model.capabilities === 'object' && model.capabilities !== null) {
    return Boolean(model.capabilities.trained_for_tool_use)
  }

  return false
}

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

    // Try to discover models from LM Studio API
    let models: LMStudioModel[]
    try {
      models = await discoverLMStudioModels(baseURL)
    } catch (error) {
      console.warn("[opencode-lmstudio] Model discovery failed", { 
        error: error instanceof Error ? error.message : String(error) 
      })
      return
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
          const modelType = categorizeModel(model.id)
          const owner = extractModelOwner(model.id)
          const modelConfig: any = {
            id: model.id,
            name: formatModelName(model),
          }

          const contextLength = model.loaded_context_length ?? model.max_context_length
          if (contextLength) {
            modelConfig.limit = {
              context: contextLength,
            }
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
              input: supportsVisionInput(model) ? ["text", "image"] : ["text"],
              output: ["text"]
            }
          }

          if (supportsToolCall(model)) {
            modelConfig.toolCall = true
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
