import type { LMStudioModel, LMStudioModelsResponse } from '../types/index.ts'

const DEFAULT_LM_STUDIO_URL = "http://127.0.0.1:1234"
const LM_STUDIO_MODELS_ENDPOINT = "/v1/models"
const API_KEY_ENV_VARS = ["LMSTUDIO_API_KEY", "LM_API_TOKEN"] as const

function isLocalOrPrivateBaseURL(baseURL?: string): boolean {
  if (!baseURL) return true

  try {
    const { hostname } = new URL(baseURL)
    const normalizedHost = hostname.toLowerCase()
    const ipv4Parts = normalizedHost.split('.').map(part => Number(part))
    const ipv6Literal = normalizedHost.startsWith("[") && normalizedHost.endsWith("]")
      ? normalizedHost.slice(1, -1)
      : undefined

    if (normalizedHost === "localhost" || normalizedHost.endsWith(".localhost")) {
      return true
    }
    if (ipv6Literal === "::1") {
      return true
    }
    if (normalizedHost.endsWith(".local")) {
      return true
    }
    if (ipv4Parts.length === 4 && ipv4Parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255)) {
      const [first, second] = ipv4Parts
      return first === 10 ||
        first === 127 ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168) ||
        (first === 169 && second === 254)
    }
    if (ipv6Literal) {
      const firstHextet = Number.parseInt(ipv6Literal.split(":")[0], 16)
      if (!Number.isNaN(firstHextet)) {
        return (firstHextet & 0xfe00) === 0xfc00 || (firstHextet & 0xffc0) === 0xfe80
      }
    }
  } catch {
    return false
  }

  return false
}

function resolveEnvSyntax(value?: string): string | undefined {
  if (!value) return undefined
  const match = value.match(/^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/)
  if (match) return process.env[match[1]]
  return value
}

export function getLMStudioApiKey(explicitApiKey?: string, baseURL?: string): string | undefined {
  const resolvedExplicitApiKey = resolveEnvSyntax(explicitApiKey)
  if (resolvedExplicitApiKey) return resolvedExplicitApiKey

  if (!isLocalOrPrivateBaseURL(baseURL)) {
    return undefined
  }

  for (const envVar of API_KEY_ENV_VARS) {
    const value = process.env[envVar]
    if (value) return value
  }

  return undefined
}

function buildHeaders(apiKey?: string, baseURL?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }

  const resolvedApiKey = getLMStudioApiKey(apiKey, baseURL)
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
      headers: buildHeaders(apiKey, baseURL),
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
      headers: buildHeaders(apiKey, baseURL),
      signal: AbortSignal.timeout(3000),
    })

    if (!response.ok) {
      return []
    }

    const data = (await response.json()) as LMStudioModelsResponse
    return data.data ?? []
  } catch (error) {
    throw new Error(`Failed to discover models: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    })
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
      headers: buildHeaders(apiKey, baseURL),
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
