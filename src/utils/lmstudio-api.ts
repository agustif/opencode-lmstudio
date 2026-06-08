import type { LMStudioModel, LMStudioModelsResponse } from '../types/index.ts'

const DEFAULT_LM_STUDIO_URL = "http://127.0.0.1:1234"
const LM_STUDIO_MODELS_ENDPOINT = "/v1/models"
const API_KEY_ENV_VARS = ["LMSTUDIO_API_KEY", "LM_API_TOKEN"] as const

function resolveEnvSyntax(value?: string): string | undefined {
  if (!value) return undefined
  const match = value.match(/^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/)
  if (match) return process.env[match[1]]
  return value
}

export function getLMStudioApiKey(explicitApiKey?: string): string | undefined {
  const resolvedExplicitApiKey = resolveEnvSyntax(explicitApiKey)
  if (resolvedExplicitApiKey) return resolvedExplicitApiKey

  for (const envVar of API_KEY_ENV_VARS) {
    const value = process.env[envVar]
    if (value) return value
  }

  return undefined
}

function buildHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }

  const resolvedApiKey = getLMStudioApiKey(apiKey)
  if (resolvedApiKey) {
    headers.Authorization = `Bearer ${resolvedApiKey}`
  }

  return headers
}

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
export async function checkLMStudioHealth(
  baseURL: string = DEFAULT_LM_STUDIO_URL,
  apiKey?: string
): Promise<boolean> {
  try {
    const url = buildAPIURL(baseURL)
    const response = await fetch(url, {
      method: "GET",
      headers: buildHeaders(apiKey),
      signal: AbortSignal.timeout(3000),
    })
    return response.ok
  } catch {
    return false
  }
}

// Discover models from LM Studio API
export async function discoverLMStudioModels(
  baseURL: string = DEFAULT_LM_STUDIO_URL,
  apiKey?: string
): Promise<LMStudioModel[]> {
  try {
    const url = buildAPIURL(baseURL)
    const response = await fetch(url, {
      method: "GET",
      headers: buildHeaders(apiKey),
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
export async function fetchModelsDirect(
  baseURL: string = DEFAULT_LM_STUDIO_URL,
  apiKey?: string
): Promise<string[]> {
  try {
    const url = buildAPIURL(baseURL)
    const response = await fetch(url, {
      method: "GET",
      headers: buildHeaders(apiKey),
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
export async function autoDetectLMStudio(apiKey?: string): Promise<string | null> {
  const commonPorts = [1234, 8080, 11434]
  for (const port of commonPorts) {
    const baseURL = `http://127.0.0.1:${port}`
    const isHealthy = await checkLMStudioHealth(baseURL, apiKey)
    if (isHealthy) {
      return baseURL
    }
  }
  return null
}
