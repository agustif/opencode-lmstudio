import type { LMStudioModel, LMStudioModelsResponse } from '../types'

const DEFAULT_LM_STUDIO_URL = "http://127.0.0.1:1234"
const LM_STUDIO_MODELS_ENDPOINT = "/v1/models"

// Check if LM Studio is accessible
export async function checkLMStudioHealth(baseURL: string = DEFAULT_LM_STUDIO_URL): Promise<boolean> {
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

// Discover models from LM Studio API
export async function discoverLMStudioModels(baseURL: string = DEFAULT_LM_STUDIO_URL): Promise<LMStudioModel[]> {
  try {
    const url = `${baseURL}${LM_STUDIO_MODELS_ENDPOINT}`
    console.log(`[opencode-lmstudio] Discovering LM Studio models`, { url })
    
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(2000), // 2 second timeout
    })

    if (!response.ok) {
      console.warn(`[opencode-lmstudio] LM Studio models endpoint not available`, { status: response.status })
      return []
    }

    const data = (await response.json()) as LMStudioModelsResponse
    console.log(`[opencode-lmstudio] Discovered LM Studio models`, { count: data.data?.length ?? 0 })
    return data.data ?? []
  } catch (error) {
    console.warn(`[opencode-lmstudio] Failed to discover LM Studio models`, { 
      error: error instanceof Error ? error.message : String(error) 
    })
    return []
  }
}

// Get currently loaded/active models from LM Studio (bypass cache)
export async function fetchModelsDirect(baseURL: string = DEFAULT_LM_STUDIO_URL): Promise<string[]> {
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

// Auto-detect LM Studio if not configured
export async function autoDetectLMStudio(): Promise<string | null> {
  const commonPorts = [1234, 8080, 11434]
  for (const port of commonPorts) {
    const baseURL = `http://127.0.0.1:${port}`
    const isHealthy = await checkLMStudioHealth(baseURL)
    if (isHealthy) {
      console.log(`[opencode-lmstudio] Auto-detected LM Studio`, { baseURL })
      return baseURL
    }
  }
  return null
}