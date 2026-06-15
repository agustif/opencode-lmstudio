import {
  LMStudioModelsResponseSchema,
  type LMStudioModel,
  type LMStudioModelsResponse,
} from "../types/index.ts"
import { isIP } from "node:net"

export const DEFAULT_LM_STUDIO_URL = "http://127.0.0.1:1234"
export const LM_STUDIO_MODELS_PATH = "/api/v0/models"
export const OPENAI_COMPATIBLE_PATH = "/v1"
export const AUTO_DETECT_URLS = [
  DEFAULT_LM_STUDIO_URL,
  "http://127.0.0.1:8080",
  "http://127.0.0.1:11434",
] as const
const API_KEY_ENV_VARS = ["LMSTUDIO_API_KEY", "LM_API_TOKEN"] as const

export interface DiscoverModelsOptions {
  readonly apiKey?: string
  readonly timeoutMs?: number
  readonly fetch?: typeof globalThis.fetch
}

export class LMStudioAPIError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = "LMStudioAPIError"
  }
}

function resolveEnvSyntax(value: string | undefined): string | undefined {
  if (!value) return undefined
  const match = value.match(/^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/)
  return match ? process.env[match[1]] : value
}

/**
 * Whether an environment fallback token can be sent without risking exposure
 * to a public host. Explicit provider tokens are always honored.
 */
export function isLocalOrPrivateURL(input: string): boolean {
  let hostname: string
  try {
    hostname = new URL(input).hostname.toLowerCase().replace(/^\[|\]$/g, "")
  } catch {
    return false
  }

  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    return true
  }
  if (isIP(hostname) === 4) {
    const [first, second] = hostname.split(".").map(Number)
    return first === 10 || first === 127 || (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) || (first === 169 && second === 254)
  }
  if (isIP(hostname) === 6) {
    if (hostname === "::1") return true
    const first = Number.parseInt(hostname.split(":")[0] || "0", 16)
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80
  }
  return false
}

export function getLMStudioApiKey(explicit: string | undefined, serverURL: string): string | undefined {
  const configured = resolveEnvSyntax(explicit)
  if (configured) return configured
  if (!isLocalOrPrivateURL(serverURL)) return undefined

  for (const name of API_KEY_ENV_VARS) {
    const value = process.env[name]
    if (value) return value
  }
  return undefined
}

/** Return the LM Studio server root for an OpenAI-compatible provider URL. */
export function normalizeLMStudioURL(input = DEFAULT_LM_STUDIO_URL): string {
  let url: URL
  try {
    url = new URL(input)
  } catch (cause) {
    throw new LMStudioAPIError(`Invalid LM Studio URL: ${input}`, cause)
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new LMStudioAPIError(`LM Studio URL must use http or https: ${input}`)
  }

  url.hash = ""
  url.search = ""
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "")
  return url.toString().replace(/\/$/, "")
}

export function toOpenAICompatibleURL(serverURL: string): string {
  return `${normalizeLMStudioURL(serverURL)}${OPENAI_COMPATIBLE_PATH}`
}

export function toModelsURL(serverURL: string): string {
  return `${normalizeLMStudioURL(serverURL)}${LM_STUDIO_MODELS_PATH}`
}

/**
 * Discover models through LM Studio's metadata-rich REST endpoint.
 *
 * There is intentionally no `/v1/models` fallback: that endpoint omits the
 * model domain, and guessing from model names can register embedding models as
 * chat models or claim unsupported capabilities.
 */
export async function discoverModels(
  serverURL: string,
  options: DiscoverModelsOptions = {},
): Promise<LMStudioModelsResponse> {
  const fetcher = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 5_000

  let response: Response
  try {
    response = await fetcher(toModelsURL(serverURL), {
      method: "GET",
      headers: options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (cause) {
    throw new LMStudioAPIError("Could not reach the LM Studio models API", cause)
  }

  if (!response.ok) {
    throw new LMStudioAPIError(`LM Studio models API returned HTTP ${response.status}`)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (cause) {
    throw new LMStudioAPIError("LM Studio models API returned invalid JSON", cause)
  }

  const result = LMStudioModelsResponseSchema.safeParse(payload)
  if (!result.success) {
    throw new LMStudioAPIError("LM Studio models API returned an unsupported response", result.error)
  }

  return result.data
}

export function isGenerativeModel(model: LMStudioModel): model is LMStudioModel & { type: "llm" | "vlm" } {
  return model.type === "llm" || model.type === "vlm"
}

export interface AutoDetectedLMStudio {
  readonly serverURL: string
  readonly apiKey?: string
  readonly response: LMStudioModelsResponse
}

/** Probe the historical auto-detection ports, accepting only LM Studio's rich typed response. */
export async function autoDetectLMStudio(): Promise<AutoDetectedLMStudio | undefined> {
  for (const serverURL of AUTO_DETECT_URLS) {
    const apiKey = getLMStudioApiKey(undefined, serverURL)
    try {
      const response = await discoverModels(serverURL, { apiKey, timeoutMs: 1_000 })
      return { serverURL, apiKey, response }
    } catch {
      // A port is considered LM Studio only if the official endpoint validates.
    }
  }
  return undefined
}
