import { ModelStatusCache } from '../cache/model-status-cache.ts'
import { ToastNotifier } from '../ui/toast-notifier.ts'
import { findSimilarModels, retryWithBackoff, categorizeError, generateAutoFixSuggestions } from '../utils/index.ts'
import { getLoadedModels } from './get-loaded-models.ts'
import { getLMStudioApiKey, normalizeBaseURL } from '../utils/lmstudio-api.ts'
import { safeAsyncOperation, isPluginHookInput, isLMStudioProvider, isValidModel } from '../utils/validation/index.ts'

const modelStatusCache = new ModelStatusCache()

export function createChatParamsHook(toastNotifier: ToastNotifier) {
  return async (input: any, output: any) => {
    // Validate input
    if (!isPluginHookInput(input)) {
      console.error("[opencode-lmstudio] Invalid chat.params input")
      return
    }
    
    const { sessionID, model, provider } = input // message not used
    
    // Validate required fields
    if (!isValidModel(model)) {
      console.error("[opencode-lmstudio] Invalid model object")
      return
    }
    
    if (!isLMStudioProvider(provider)) {
      // Not an LM Studio provider, skip
      return
    }

    
    const baseURL = normalizeBaseURL(provider.options?.baseURL || "http://127.0.0.1:1234")
    const apiKey = getLMStudioApiKey(provider.options?.apiKey, baseURL)
    
    // Show loading notification
    await safeAsyncOperation(
      () => toastNotifier.progress(`Checking model ${model.id}...`, "Model Validation", 10),
      undefined,
      (error: Error) => console.warn("[opencode-lmstudio] Failed to show progress toast:", error)
    )
    
    // Use retry logic for model validation
    const validationResult = await retryWithBackoff(
      async () => {
        const loadedModels = await getLoadedModels(baseURL, apiKey)
        const isModelLoaded = loadedModels.includes(model.id)
        
        if (!isModelLoaded) {
          throw new Error(`Model '${model.id}' not loaded`)
        }
        
        return loadedModels
      },
      2, // Max 2 retries for model validation
      500 // 500ms base delay
    )
    
    if (!validationResult.success || !validationResult.result) {
      // Categorize error and provide smart suggestions
      const errorCategory = categorizeError(validationResult.error || "Validation operation failed", { baseURL, modelId: model.id })
      const autoFixSuggestions = generateAutoFixSuggestions(errorCategory)
      
      console.warn("[opencode-lmstudio] Model validation failed", { 
        sessionID,
        model: model.id,
        error: validationResult.error,
        errorType: errorCategory.type,
        severity: errorCategory.severity,
        baseURL
      })
      
      // Get available models for similarity matching
      let availableModels: string[] = []
      try {
        availableModels = await getLoadedModels(baseURL, apiKey)
      } catch (e) {
        console.warn("[opencode-lmstudio] Failed to get available models for suggestions", { error: e })
      }
      
      // Use enhanced similarity matching
      const similarModels = findSimilarModels(model.id, availableModels)
      
      // Show error toast
      await toastNotifier.error(
        `Model '${model.id}' not ready: ${errorCategory.message}`,
        "Model Validation Failed",
        8000
      )
      
      // Provide comprehensive error response
      if (!output.options) {
        output.options = {}
      }
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
          "6. Ensure the server is running",
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
      const cacheStats = modelStatusCache.getStats()
      const cacheEntry = cacheStats.entries.find(entry => entry.baseURL === baseURL)
      const cacheAge = cacheEntry ? cacheEntry.age : 0
      
      const loadedModels = validationResult.result || []
      
      // Show success toast
      await toastNotifier.success(`Model '${model.id}' is ready to use`, "Model Validated")
      
      if (!output.options) {
        output.options = {}
      }
      output.options.lmstudioValidation = {
        status: "success",
        model: model.id,
        availableModels: loadedModels,
        message: `Model '${model.id}' is loaded and ready.`,
        cacheInfo: {
          age: cacheAge,
          valid: modelStatusCache.isValid(baseURL),
          totalCacheEntries: cacheStats.size
        },
        performanceHint: loadedModels.length > 1 
          ? `Note: ${loadedModels.length} models loaded. Consider unloading unused models for better performance.` 
          : cacheAge > 20000 // Cache is getting old
          ? `Cache is ${Math.round(cacheAge/1000)}s old. Consider refreshing if model status seems outdated.`
          : undefined
      }
    }
  }
}
