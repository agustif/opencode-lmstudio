import type {
  LMStudioAPIV1Model,
  LMStudioAPIV1ModelsResponse,
  LMStudioModel,
  LMStudioModelsResponse,
} from '../types'

const DEFAULT_LM_STUDIO_URL = "http://127.0.0.1:1234"
const LM_STUDIO_MODELS_ENDPOINT = "/v1/models"
const LM_STUDIO_MODELS_ENDPOINT_API_V0 = "/api/v0/models"
const LM_STUDIO_MODELS_ENDPOINT_API_V1 = "/api/v1/models"

// Normalize base URL to ensure consistent format
export function normalizeBaseURL(baseURL: string = DEFAULT_LM_STUDIO_URL): string {
  // Remove trailing slash
  let normalized = baseURL.replace(/\/+$/, '')
  
  // Remove /v1 suffix if present
  if (normalized.endsWith('/v1')) {
    normalized = normalized.slice(0, -3)
  }
  
  return normalized
}

// Build full API URL with endpoint
export function buildAPIURL(baseURL: string, endpoint: string = LM_STUDIO_MODELS_ENDPOINT): string {
  const normalized = normalizeBaseURL(baseURL)
  return `${normalized}${endpoint}`
}

function resolveLoadedContextLength(model: LMStudioAPIV1Model): number | undefined {
  return model.loaded_instances?.find(instance => instance?.config?.context_length)?.config?.context_length
}

function normalizeAPIV1Model(model: LMStudioAPIV1Model): LMStudioModel {
  return {
    id: model.key,
    object: "model",
    display_name: model.display_name,
    type: model.type,
    publisher: model.publisher,
    arch: model.architecture,
    compatibility_type: model.format,
    max_context_length: model.max_context_length,
    loaded_context_length: resolveLoadedContextLength(model),
    capabilities: model.capabilities,
    loaded_instances: model.loaded_instances,
  }
}

async function fetchJSON<T>(url: string): Promise<T | null> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(3000),
  })

  if (!response.ok) {
    return null
  }

  return (await response.json()) as T
}

// Check if LM Studio is accessible
export async function checkLMStudioHealth(baseURL: string = DEFAULT_LM_STUDIO_URL): Promise<boolean> {
  try {
    const url = buildAPIURL(baseURL)
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    })
    return response.ok
  } catch {
    return false
  }
}

// Discover models from LM Studio API
export async function discoverLMStudioModels(baseURL: string = DEFAULT_LM_STUDIO_URL): Promise<LMStudioModel[]> {
  try {
    const apiV1Data = await fetchJSON<LMStudioAPIV1ModelsResponse>(
      buildAPIURL(baseURL, LM_STUDIO_MODELS_ENDPOINT_API_V1)
    )
    if (apiV1Data?.models?.length) {
      return apiV1Data.models.map(normalizeAPIV1Model)
    }

    const apiV0Data = await fetchJSON<LMStudioModelsResponse>(
      buildAPIURL(baseURL, LM_STUDIO_MODELS_ENDPOINT_API_V0)
    )
    if (apiV0Data?.data?.length) {
      return apiV0Data.data
    }

    const openAIData = await fetchJSON<LMStudioModelsResponse>(buildAPIURL(baseURL))
    return openAIData?.data ?? []
  } catch (error) {
    throw new Error(`Failed to discover models: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// Get currently loaded/active models from LM Studio (bypass cache)
export async function fetchModelsDirect(baseURL: string = DEFAULT_LM_STUDIO_URL): Promise<string[]> {
  try {
    const url = buildAPIURL(baseURL)
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    
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
      return baseURL
    }
  }
  return null
}
