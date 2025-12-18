import type { Plugin } from "@opencode-ai/plugin"

const DEFAULT_LM_STUDIO_URL = "http://127.0.0.1:1234"
const LM_STUDIO_MODELS_ENDPOINT = "/v1/models"

interface LMStudioModel {
  id: string
  object: string
  created: number
  owned_by: string
}

interface LMStudioModelsResponse {
  object: string
  data: LMStudioModel[]
}

// Simple logging utility for standalone plugin
const log = {
  info: (message: string, data?: Record<string, any>) => {
    if (typeof console !== "undefined" && console.log) {
      console.log(`[opencode-lmstudio] ${message}`, data || "")
    }
  },
  warn: (message: string, data?: Record<string, any>) => {
    if (typeof console !== "undefined" && console.warn) {
      console.warn(`[opencode-lmstudio] ${message}`, data || "")
    }
  },
}

/**
 * LM Studio Plugin
 * 
 * Enhances LM Studio support with:
 * - Auto-detection of running LM Studio instance
 * - Dynamic model discovery from LM Studio API
 * - Health check monitoring
 * - Better integration with LM Studio's model management
 */
export const LMStudioPlugin: Plugin = async ({ $, directory }) => {
  log.info("LM Studio plugin initialized")

  // Check if LM Studio is running and discover models
  async function discoverLMStudioModels(baseURL: string = DEFAULT_LM_STUDIO_URL): Promise<LMStudioModel[]> {
    try {
      const url = `${baseURL}${LM_STUDIO_MODELS_ENDPOINT}`
      log.info("Discovering LM Studio models", { url })
      
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(2000), // 2 second timeout
      })

      if (!response.ok) {
        log.warn("LM Studio models endpoint not available", { status: response.status })
        return []
      }

      const data = (await response.json()) as LMStudioModelsResponse
      log.info("Discovered LM Studio models", { count: data.data?.length ?? 0 })
      return data.data ?? []
    } catch (error) {
      log.warn("Failed to discover LM Studio models", { 
        error: error instanceof Error ? error.message : String(error) 
      })
      return []
    }
  }

  // Check if LM Studio is accessible
  async function checkLMStudioHealth(baseURL: string = DEFAULT_LM_STUDIO_URL): Promise<boolean> {
    try {
      const url = `${baseURL}${LM_STUDIO_MODELS_ENDPOINT}`
      const response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(2000),
      })
      return response.ok
    } catch {
      return false
    }
  }

  // Get currently loaded/active models from LM Studio
  async function getLoadedModels(baseURL: string = DEFAULT_LM_STUDIO_URL): Promise<string[]> {
    try {
      const url = `${baseURL}${LM_STUDIO_MODELS_ENDPOINT}`
      const response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(2000),
      })
      if (!response.ok) return []
      
      const data = (await response.json()) as LMStudioModelsResponse
      return data.data?.map(model => model.id) || []
    } catch {
      return []
    }
  }

  // Categorize models by type
  function categorizeModel(modelId: string): 'chat' | 'embedding' | 'unknown' {
    const lowerId = modelId.toLowerCase()
    if (lowerId.includes('embedding') || lowerId.includes('embed')) {
      return 'embedding'
    }
    if (lowerId.includes('gpt') || lowerId.includes('llama') || 
        lowerId.includes('claude') || lowerId.includes('qwen') ||
        lowerId.includes('mistral') || lowerId.includes('gemma') ||
        lowerId.includes('phi') || lowerId.includes('falcon')) {
      return 'chat'
    }
    return 'unknown'
  }

  // Enhanced model similarity matching
  function findSimilarModels(targetModel: string, availableModels: string[]): Array<{ model: string; similarity: number; reason: string }> {
    const target = targetModel.toLowerCase()
    const targetTokens = target.split(/[-_\s]/).filter(Boolean)
    
    return availableModels
      .map(model => {
        const candidate = model.toLowerCase()
        const candidateTokens = candidate.split(/[-_\s]/).filter(Boolean)
        
        let similarity = 0
        const reasons: string[] = []
        
        // Exact match gets highest score
        if (candidate === target) {
          similarity = 1.0
          reasons.push("Exact match")
        }
        
        // Check for common model family prefixes
        const targetPrefix = targetTokens[0]
        const candidatePrefix = candidateTokens[0]
        if (targetPrefix && candidatePrefix && targetPrefix === candidatePrefix) {
          similarity += 0.5
          reasons.push(`Same family: ${targetPrefix}`)
        }
        
        // Check for common suffixes (quantization levels, sizes)
        const commonSuffixes = ['3b', '7b', '13b', '70b', 'q4', 'q8', 'instruct', 'chat', 'base']
        for (const suffix of commonSuffixes) {
          if (target.includes(suffix) && candidate.includes(suffix)) {
            similarity += 0.2
            reasons.push(`Shared suffix: ${suffix}`)
          }
        }
        
        // Token overlap score
        const commonTokens = targetTokens.filter(token => candidateTokens.includes(token))
        if (commonTokens.length > 0) {
          similarity += (commonTokens.length / Math.max(targetTokens.length, candidateTokens.length)) * 0.3
          reasons.push(`Common tokens: ${commonTokens.join(', ')}`)
        }
        
        return {
          model,
          similarity: Math.min(similarity, 1.0),
          reason: reasons.join(", ")
        }
      })
      .filter(item => item.similarity > 0.1) // Only include models with some similarity
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5) // Top 5 suggestions
  }

  // Retry logic with exponential backoff
  async function retryWithBackoff<T>(
    operation: () => Promise<T>, 
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<{ success: boolean; result?: T; error?: string }> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await operation()
        return { success: true, result }
      } catch (error) {
        if (attempt === maxRetries) {
          return { 
            success: false, 
            error: error instanceof Error ? error.message : String(error) 
          }
        }
        
        const delay = baseDelay * Math.pow(2, attempt)
        log.warn(`Retrying operation after ${delay}ms`, { 
          attempt: attempt + 1, 
          maxRetries: maxRetries + 1,
          error: error instanceof Error ? error.message : String(error)
        })
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
    return { success: false, error: "Max retries exceeded" }
  }

  // Smart error categorization
  function categorizeError(error: any, context: { baseURL: string; modelId: string }): {
    type: 'offline' | 'not_found' | 'network' | 'permission' | 'timeout' | 'unknown'
    severity: 'low' | 'medium' | 'high' | 'critical'
    message: string
    canRetry: boolean
    autoFixAvailable: boolean
  } {
    const errorStr = String(error).toLowerCase()
    const { baseURL, modelId } = context
    
    // Network/connection issues
    if (errorStr.includes('econnrefused') || errorStr.includes('fetch failed') || errorStr.includes('network')) {
      return {
        type: 'offline',
        severity: 'critical',
        message: `Cannot connect to LM Studio at ${baseURL}. Ensure LM Studio is running and the server is active.`,
        canRetry: true,
        autoFixAvailable: true
      }
    }
    
    // Timeout issues
    if (errorStr.includes('timeout') || errorStr.includes('aborted')) {
      return {
        type: 'timeout',
        severity: 'medium',
        message: `Request to LM Studio timed out. This might happen with large models or slow systems.`,
        canRetry: true,
        autoFixAvailable: false
      }
    }
    
    // Model not found
    if (errorStr.includes('404') || errorStr.includes('not found')) {
      return {
        type: 'not_found',
        severity: 'high',
        message: `Model '${modelId}' not found. Check if the model is installed in LM Studio.`,
        canRetry: false,
        autoFixAvailable: false
      }
    }
    
    // Permission issues
    if (errorStr.includes('401') || errorStr.includes('403') || errorStr.includes('unauthorized')) {
      return {
        type: 'permission',
        severity: 'high',
        message: `Authentication or permission issue with LM Studio. Check your configuration.`,
        canRetry: false,
        autoFixAvailable: false
      }
    }
    
    // Unknown errors
    return {
      type: 'unknown',
      severity: 'medium',
      message: `Unexpected error: ${errorStr}`,
      canRetry: true,
      autoFixAvailable: false
    }
  }

  // Generate auto-fix suggestions
  function generateAutoFixSuggestions(errorCategory: ReturnType<typeof categorizeError>): Array<{
    action: string
    command?: string
    steps?: string[]
    automated: boolean
  }> {
    const suggestions = []
    
    switch (errorCategory.type) {
      case 'offline':
        suggestions.push({
          action: "Check if LM Studio is running",
          steps: [
            "1. Open LM Studio application",
            "2. Verify the server is started",
            "3. Check the server status indicator",
            "4. Verify the server URL and port"
          ],
          automated: false
        })
        suggestions.push({
          action: "Try alternative ports",
          steps: [
            "1. Check if LM Studio is running on a different port",
            "2. Common ports: 1234, 8080, 11434",
            "3. Update your OpenCode configuration"
          ],
          automated: false
        })
        break
        
      case 'not_found':
        suggestions.push({
          action: "Browse and install model",
          steps: [
            "1. Open LM Studio",
            "2. Click the search icon (🔍)",
            "3. Search for your desired model",
            "4. Click 'Download' and wait for completion",
            "5. Load the model after download"
          ],
          automated: false
        })
        break
        
      case 'timeout':
        suggestions.push({
          action: "Increase timeout or use smaller model",
          steps: [
            "1. Try a smaller model version",
            "2. Increase request timeout in settings",
            "3. Close other applications to free resources"
          ],
          automated: false
        })
        break
    }
    
    return suggestions
  }

  // Auto-detect LM Studio if not configured
  async function autoDetectLMStudio(): Promise<string | null> {
    const commonPorts = [1234, 8080, 11434]
    for (const port of commonPorts) {
      const baseURL = `http://127.0.0.1:${port}`
      const isHealthy = await checkLMStudioHealth(baseURL)
      if (isHealthy) {
        log.info("Auto-detected LM Studio", { baseURL })
        return baseURL
      }
    }
    return null
  }

  // Enhance config with discovered models
  async function enhanceConfig(config: any) {
    let lmstudioProvider = config.provider?.lmstudio
    let baseURL: string

    // If lmstudio provider exists, use its baseURL
    if (lmstudioProvider) {
      baseURL = lmstudioProvider.options?.baseURL || DEFAULT_LM_STUDIO_URL
      // Remove /v1 suffix if present for health check
      if (baseURL.includes("/v1")) {
        baseURL = baseURL.replace(/\/v1\/?$/, "")
      }
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
      log.info("Auto-configured LM Studio provider", { baseURL: `${baseURL}/v1` })
    }

    // Normalize baseURL (remove /v1 if present, we'll add it back)
    // Handle both http://127.0.0.1:1234/v1 and http://127.0.0.1:1234 formats
    let normalizedBaseURL = baseURL
    if (normalizedBaseURL.includes("/v1")) {
      normalizedBaseURL = normalizedBaseURL.replace(/\/v1\/?$/, "")
    }

    // Check health first
    const isHealthy = await checkLMStudioHealth(normalizedBaseURL)
    if (!isHealthy) {
      log.warn("LM Studio appears to be offline", { baseURL: normalizedBaseURL })
      return
    }

    // Try to discover models from LM Studio API
    const models = await discoverLMStudioModels(normalizedBaseURL)
    
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
          const modelConfig: any = {
            id: model.id,
            name: `${model.id} (LM Studio)`,
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

          discoveredModels[modelKey] = modelConfig
        }
      }

      // Merge discovered models into config
      if (Object.keys(discoveredModels).length > 0) {
        config.provider.lmstudio.models = {
          ...existingModels,
          ...discoveredModels,
        }
        log.info("Added discovered LM Studio models to config", { 
          total: Object.keys(discoveredModels).length,
          chat: chatModelsCount,
          embedding: embeddingModelsCount
        })

        // Provide helpful guidance if no chat models are available
        if (chatModelsCount === 0 && embeddingModelsCount > 0) {
          log.warn("Only embedding models found. To use chat models:", {
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
      log.warn("No models found in LM Studio. Please:", {
        steps: [
          "1. Open LM Studio application",
          "2. Download and load a model",
          "3. Start the server"
        ]
      })
    }
  }

  return {
    config: async (config) => {
      await enhanceConfig(config)
    },
    
    event: async ({ event }) => {
      // Monitor for session events to provide LM Studio status
      if (event.type === "session.created" || event.type === "session.updated") {
        // Could add health check monitoring here in the future
      }
    },

    // Enhanced model validation with smart error handling
    "chat.params": async (input, output) => {
      const { sessionID, agent, model, provider, message } = input
      
      // Only handle LM Studio provider
      if (provider.info.id !== "lmstudio") {
        return
      }

      log.info("LM Studio model about to be used", { 
        sessionID, 
        agent, 
        modelID: model.id,
        providerID: provider.info.id 
      })
      
      const baseURL = provider.options?.baseURL?.replace('/v1', '') || DEFAULT_LM_STUDIO_URL
      
      // Use retry logic for model validation
      const validation = await retryWithBackoff(
        async () => {
          const loadedModels = await getLoadedModels(baseURL)
          const isModelLoaded = loadedModels.includes(model.id)
          
          if (!isModelLoaded) {
            throw new Error(`Model '${model.id}' not loaded`)
          }
          
          return loadedModels
        },
        2, // Max 2 retries for model validation
        500 // 500ms base delay
      )
      
      if (!validation.success) {
        // Categorize the error and provide smart suggestions
        const errorCategory = categorizeError(validation.error, { baseURL, modelId: model.id })
        const autoFixSuggestions = generateAutoFixSuggestions(errorCategory)
        
        log.warn("Model validation failed", { 
          sessionID,
          model: model.id,
          error: validation.error,
          errorType: errorCategory.type,
          severity: errorCategory.severity,
          baseURL
        })
        
        // Get available models for similarity matching (last attempt)
        let availableModels: string[] = []
        try {
          availableModels = await getLoadedModels(baseURL)
        } catch (e) {
          log.warn("Failed to get available models for suggestions", { error: e })
        }
        
        // Use enhanced similarity matching
        const similarModels = findSimilarModels(model.id, availableModels)
        
        // Provide comprehensive error response
        output.options.lmstudioValidation = {
          status: "error",
          model: model.id,
          availableModels,
          errorCategory: errorCategory.type,
          severity: errorCategory.severity,
          message: errorCategory.message,
          canRetry: errorCategory.canRetry,
          autoFixAvailable: errorCategory.autoFixAvailable,
          autoFixSuggestions,
          steps: errorCategory.type === 'not_found' ? [
            "1. Open LM Studio application",
            "2. Click the search icon (🔍) in the sidebar",
            "3. Search for your desired model",
            "4. Click 'Download' and wait for completion",
            "5. Load the model after download",
            "6. Ensure server is running",
            "7. Try your request again"
          ] : [
            "1. Open LM Studio application",
            "2. Verify the server is active (green indicator)",
            "3. Check the server URL and port",
            "4. Try loading the model manually",
            "5. Retry your request"
          ],
          similarModels: similarModels.map(item => ({
            model: item.model,
            similarity: Math.round(item.similarity * 100),
            reason: item.reason
          }))
        }
      } else {
        log.info("Model validation successful", { 
          sessionID,
          model: model.id,
          totalAvailable: validation.result?.length || 0,
          retries: validation.success ? 0 : 1
        })
        
        output.options.lmstudioValidation = {
          status: "success",
          model: model.id,
          availableModels: validation.result || [],
          message: `Model '${model.id}' is loaded and ready.`,
          performanceHint: validation.result && validation.result.length > 1 
            ? `Note: ${validation.result.length} models loaded. Consider unloading unused models for better performance.` 
            : undefined
        }
      }
    },

  }
}

