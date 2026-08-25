import type {
  LMStudioModel,
  LMStudioModelsResponse,
  ModelConfig,
  OpenCodeConfig,
  PluginLogger,
  ProviderConfig,
} from "../types/index.ts"
import type { DiscoverModelsOptions } from "../utils/lmstudio-api.ts"
import {
  DEFAULT_LM_STUDIO_URL,
  LM_STUDIO_MODELS_PATH,
  OPENAI_MODELS_PATH,
  autoDetectLMStudio,
  discoverModels,
  discoverOpenAIModels,
  getLMStudioApiKey,
  isGenerativeModel,
  normalizeLMStudioURL,
  toOpenAICompatibleURL,
} from "../utils/lmstudio-api.ts"

export interface EnhanceConfigResult {
  readonly discovered: number
  readonly discoveryPath: string
  readonly models: Readonly<Record<string, ModelConfig>>
  readonly skippedEmbeddings: number
  readonly skippedUnsupported: number
  readonly serverURL: string
  readonly toolUse: {
    readonly default: readonly string[]
    readonly native: readonly string[]
    readonly unknown: readonly string[]
  }
}

const MAX_OUTPUT_RESERVE = 8_192
/** Conservative context assumed for OpenAI-compatible IDs that report none. */
const DEFAULT_OPENAI_CONTEXT = 32_768
export type ToolUseMode = "default" | "native" | "unknown"
interface GeneratedState {
  readonly models: Readonly<Record<string, ModelConfig>>
  readonly whitelist?: readonly string[]
}
const generatedStates = new WeakMap<OpenCodeConfig, GeneratedState>()

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export function effectiveContextLength(model: LMStudioModel): number {
  const loaded = model.loaded_instances.map((instance) => instance.config.context_length)
  return loaded.length === 0
    ? model.max_context_length
    : Math.min(model.max_context_length, ...loaded)
}

/** Classify LM Studio's native-vs-default tool handling without disabling tools. */
export function toolUseMode(model: LMStudioModel): ToolUseMode {
  const trained = model.capabilities?.trained_for_tool_use
  return trained === true ? "native" : trained === false ? "default" : "unknown"
}

export function toModelConfig(model: LMStudioModel & { type: "llm" }): ModelConfig {
  const vision = model.capabilities?.vision === true
  const input: Array<"text" | "image"> = vision ? ["text", "image"] : ["text"]
  const context = effectiveContextLength(model)

  return {
    id: model.key,
    name: model.display_name,
    attachment: vision,
    // LM Studio supports tools for every LLM. The training flag distinguishes
    // native handling from its lower-reliability default tool format; it does
    // not mean that tool calls are unsupported.
    tool_call: true,
    modalities: {
      input,
      output: ["text"],
    },
    // LM Studio reports context capacity but not a distinct generation limit.
    // This conservative plugin policy gives OpenCode the required output field
    // without claiming that LM Studio supplied one.
    limit: {
      context,
      output: Math.min(MAX_OUTPUT_RESERVE, Math.max(1, Math.floor(context / 4))),
    },
  }
}

/** Build an OpenCode model from an OpenAI-compatible `/v1/models` record id. */
export function toModelConfigFromID(id: string, context = DEFAULT_OPENAI_CONTEXT): ModelConfig {
  return {
    id,
    name: id,
    attachment: false,
    tool_call: true,
    modalities: {
      input: ["text"],
      output: ["text"],
    },
    limit: {
      context,
      output: Math.min(MAX_OUTPUT_RESERVE, Math.max(1, Math.floor(context / 4))),
    },
  }
}

/** Discover models using native LM Studio v1 first, falling back to OpenAI-compatible /v1/models. */
async function discoverCatalog(
  serverURL: string,
  options: DiscoverModelsOptions,
  preFetched?: LMStudioModelsResponse,
): Promise<EnhanceConfigResult> {
  try {
    const response = preFetched ?? await discoverModels(serverURL, options)
    const generative = response.models.filter(isGenerativeModel)
    return {
      discovered: generative.length,
      discoveryPath: LM_STUDIO_MODELS_PATH,
      models: Object.fromEntries(
        generative.map((model) => [model.key, toModelConfig(model)]),
      ),
      skippedEmbeddings: response.models.filter((model) => model.type === "embedding").length,
      skippedUnsupported: response.models.filter(
        (model) => !isGenerativeModel(model) && model.type !== "embedding",
      ).length,
      serverURL,
      toolUse: {
        default: generative.filter((m) => toolUseMode(m) === "default").map((m) => m.key),
        native: generative.filter((m) => toolUseMode(m) === "native").map((m) => m.key),
        unknown: generative.filter((m) => toolUseMode(m) === "unknown").map((m) => m.key),
      },
    }
  } catch (nativeError) {
    try {
      const ids = await discoverOpenAIModels(serverURL, options)
      return {
        discovered: ids.length,
        discoveryPath: OPENAI_MODELS_PATH,
        models: Object.fromEntries(ids.map((id) => [id, toModelConfigFromID(id)])),
        skippedEmbeddings: 0,
        skippedUnsupported: 0,
        serverURL,
        toolUse: { default: [], native: [], unknown: [...ids] },
      }
    } catch {
      throw nativeError
    }
  }
}

function mergeProvider(
  existing: ProviderConfig | undefined,
  explicitModels: Record<string, ModelConfig>,
  serverURL: string,
  discoveredModels: Record<string, ModelConfig>,
  shouldGenerateWhitelist: boolean,
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
      ...explicitModels,
    },
    ...(shouldGenerateWhitelist
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
    const serverURL = normalizeLMStudioURL(configuredBaseURL ?? detected?.serverURL ?? DEFAULT_LM_STUDIO_URL)
    const apiKey = existing ? getLMStudioApiKey(explicitApiKey, serverURL) : detected?.apiKey
    const discovery = await discoverCatalog(serverURL, { apiKey }, detected?.response)
    const discoveredModels = discovery.models
    const previousGenerated = generatedStates.get(config)
    const generatedWhitelist = previousGenerated?.whitelist !== undefined
      && previousGenerated.whitelist.length === (existing?.whitelist?.length ?? 0)
      && previousGenerated.whitelist.every((id, index) => existing?.whitelist?.[index] === id)
    const shouldGenerateWhitelist = generatedWhitelist || existing?.whitelist === undefined
    const explicitModels = Object.fromEntries(
      Object.entries(existing?.models ?? {}).filter(([id, model]) => {
        const generated = previousGenerated?.models[id]
        return generated === undefined || JSON.stringify(model) !== JSON.stringify(generated)
      }),
    )

    config.provider ??= {}
    config.provider.lmstudio = mergeProvider(
      existing,
      explicitModels,
      serverURL,
      discoveredModels,
      shouldGenerateWhitelist,
      apiKey,
    )
    generatedStates.set(config, {
      models: discoveredModels,
      ...(shouldGenerateWhitelist ? { whitelist: Object.keys(discoveredModels) } : {}),
    })

    const result: EnhanceConfigResult = {
      discovered: discovery.discovered,
      discoveryPath: discovery.discoveryPath,
      models: discoveredModels,
      skippedEmbeddings: discovery.skippedEmbeddings,
      skippedUnsupported: discovery.skippedUnsupported,
      serverURL,
      toolUse: discovery.toolUse,
    }
    await log("info", "Discovered LM Studio models", result as unknown as Record<string, unknown>)
    return result
  } catch (error) {
    const configured = Boolean(existing)
    const serverURL = configuredBaseURL ?? DEFAULT_LM_STUDIO_URL
    await log(configured ? "warn" : "debug", "LM Studio model discovery unavailable", {
      discoveryPath: LM_STUDIO_MODELS_PATH,
      serverURL,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}
