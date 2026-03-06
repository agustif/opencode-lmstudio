import type { LMStudioModel, LMStudioModelsResponse } from '../types'
import { getHeaders } from './http'

const DEFAULT_LM_STUDIO_URL = "http://127.0.0.1:1234"
const LM_STUDIO_MODELS_ENDPOINT = "/v1/models"

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

// Check if LM Studio is accessible
export async function checkLMStudioHealth(baseURL: string = DEFAULT_LM_STUDIO_URL): Promise<boolean> {
  try {
    const url = buildAPIURL(baseURL)
    const headers = getHeaders()
    const response = await fetch(url, {
      method: "GET",
      headers: headers,
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
    const url = buildAPIURL(baseURL)
    const headers = getHeaders()
    const response = await fetch(url, {
      method: "GET",
      headers: headers,
      signal: AbortSignal.timeout(3000),
    })

    if (!response.ok) {
      return []
    }

    const data = (await response.json()) as LMStudioModelsResponse
    return data.data ?? []
  } catch (error) {
    throw new Error(`Failed to discover models: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// Get currently loaded/active models from LM Studio (bypass cache)
export async function fetchModelsDirect(baseURL: string = DEFAULT_LM_STUDIO_URL): Promise<string[]> {
  try {
    const url = buildAPIURL(baseURL)
    const headers = getHeaders()
    const response = await fetch(url, {
      method: "GET",
      headers: headers,
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