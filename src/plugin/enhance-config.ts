import type {
  LMStudioModel,
  ModelConfig,
  OpenCodeConfig,
  PluginLogger,
  ProviderConfig,
} from "../types/index.ts"
import {
  DEFAULT_LM_STUDIO_URL,
  autoDetectLMStudio,
  discoverModels,
  getLMStudioApiKey,
  isGenerativeModel,
  normalizeLMStudioURL,
  toOpenAICompatibleURL,
} from "../utils/lmstudio-api.ts"

export interface EnhanceConfigResult {
  readonly discovered: number
  readonly skippedEmbeddings: number
  readonly skippedUnsupported: number
  readonly serverURL: string
}

const MAX_OUTPUT_RESERVE = 8_192

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export function toModelConfig(model: LMStudioModel & { type: "llm" | "vlm" }): ModelConfig {
  const input: Array<"text" | "image"> = model.type === "vlm" ? ["text", "image"] : ["text"]

  return {
    id: model.id,
    name: model.id,
    attachment: model.type === "vlm",
    modalities: {
      input,
      output: ["text"],
    },
    // LM Studio reports a shared context window but no separate output limit.
    // Reserve a bounded quarter of that official window so OpenCode can use
    // context-aware compaction without reserving the entire prompt budget.
    ...(model.max_context_length ? {
      limit: {
        context: model.max_context_length,
        output: Math.min(MAX_OUTPUT_RESERVE, Math.max(1, Math.floor(model.max_context_length / 4))),
      },
    } : {}),
  }
}

function mergeProvider(
  existing: ProviderConfig | undefined,
  serverURL: string,
  discoveredModels: Record<string, ModelConfig>,
  apiKey?: string,
): ProviderConfig {
  return {
    ...existing,
    name: existing?.name ?? "LM Studio",
    npm: existing?.npm ?? "@ai-sdk/openai-compatible",
    options: {
      ...existing?.options,
      baseURL: toOpenAICompatibleURL(serverURL),
      ...(apiKey && !existing?.options?.apiKey ? { apiKey } : {}),
    },
    // Explicit user configuration always wins over discovered metadata.
    models: {
      ...discoveredModels,
      ...existing?.models,
    },
    ...(!existing?.whitelist?.length && Object.keys(discoveredModels).length > 0
      ? { whitelist: Object.keys(discoveredModels) }
      : {}),
  }
}

/** Enrich the documented `lmstudio` provider from reported model metadata. */
export async function enhanceConfig(config: OpenCodeConfig, log: PluginLogger): Promise<EnhanceConfigResult | undefined> {
  const existing = config.provider?.lmstudio
  const configuredBaseURL = getString(existing?.options?.baseURL)

  try {
    const explicitApiKey = getString(existing?.options?.apiKey)
    const detected = existing ? undefined : await autoDetectLMStudio()
    if (!existing && !detected) {
      await log("debug", "LM Studio model discovery unavailable", {
        serverURL: DEFAULT_LM_STUDIO_URL,
      })
      return undefined
    }

    const serverURL = normalizeLMStudioURL(configuredBaseURL ?? detected?.serverURL ?? DEFAULT_LM_STUDIO_URL)
    const apiKey = existing ? getLMStudioApiKey(explicitApiKey, serverURL) : detected?.apiKey
    const response = detected?.response ?? await discoverModels(serverURL, { apiKey })
    const generative = response.data.filter(isGenerativeModel)
    const discoveredModels = Object.fromEntries(
      generative.map((model) => [model.id, toModelConfig(model)]),
    )

    config.provider ??= {}
    config.provider.lmstudio = mergeProvider(existing, serverURL, discoveredModels, apiKey)

    const result = {
      discovered: generative.length,
      skippedEmbeddings: response.data.filter((model) => model.type === "embeddings").length,
      skippedUnsupported: response.data.filter((model) => !isGenerativeModel(model) && model.type !== "embeddings").length,
      serverURL,
    }
    await log("info", "Discovered LM Studio models", result)
    return result
  } catch (error) {
    const configured = Boolean(existing)
    const serverURL = configuredBaseURL ?? DEFAULT_LM_STUDIO_URL
    await log(configured ? "warn" : "debug", "LM Studio model discovery unavailable", {
      serverURL,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}
