import type {
  LMStudioModel,
  ModelConfig,
  OpenCodeConfig,
  PluginLogger,
  ProviderConfig,
} from "../types/index.ts"
import {
  DEFAULT_LM_STUDIO_URL,
  LM_STUDIO_MODELS_PATH,
  autoDetectLMStudio,
  discoverModels,
  getLMStudioApiKey,
  isGenerativeModel,
  normalizeLMStudioURL,
  toOpenAICompatibleURL,
} from "../utils/lmstudio-api.ts"

export interface EnhanceConfigResult {
  readonly discovered: number
  readonly discoveryPath: string
  readonly mergedDuplicates: number
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
export type ToolUseMode = "default" | "native" | "unknown"
interface GeneratedState {
  readonly models: Readonly<Record<string, ModelConfig>>
  readonly whitelist?: readonly string[]
}
const generatedStates = new WeakMap<OpenCodeConfig, GeneratedState>()

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/**
 * Collapse native records that repeat a single `key`.
 *
 * LM Studio can report one model once per host it is served from, each record
 * listing only that host's `loaded_instances`. Mapping those records straight
 * into an object keeps whichever arrived last and silently discards the other
 * host's instances, so `effectiveContextLength` can report an allocation
 * larger than a routed instance actually has — the opposite of the documented
 * conservative-minimum policy.
 *
 * Instances are unioned and de-duplicated by id so the minimum is taken across
 * every reported instance. Scalar metadata comes from the first record, which
 * observed duplicates repeat identically, except `max_context_length`: that
 * takes the smallest reported value so a merged record never overstates any
 * record it replaces.
 */
export function mergeDuplicateKeys<T extends LMStudioModel>(models: readonly T[]): T[] {
  const merged = new Map<string, T>()

  for (const model of models) {
    const previous = merged.get(model.key)
    if (previous === undefined) {
      merged.set(model.key, model)
      continue
    }

    const seen = new Set(previous.loaded_instances.map((instance) => instance.id))
    merged.set(model.key, {
      ...previous,
      max_context_length: Math.min(previous.max_context_length, model.max_context_length),
      loaded_instances: [
        ...previous.loaded_instances,
        ...model.loaded_instances.filter((instance) => !seen.has(instance.id)),
      ],
    })
  }

  return [...merged.values()]
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
    if (!existing && !detected) {
      await log("debug", "LM Studio model discovery unavailable", {
        discoveryPath: LM_STUDIO_MODELS_PATH,
        serverURL: DEFAULT_LM_STUDIO_URL,
      })
      return undefined
    }

    const serverURL = normalizeLMStudioURL(configuredBaseURL ?? detected?.serverURL ?? DEFAULT_LM_STUDIO_URL)
    const apiKey = existing ? getLMStudioApiKey(explicitApiKey, serverURL) : detected?.apiKey
    const response = detected?.response ?? await discoverModels(serverURL, { apiKey })
    const llmRecords = response.models.filter(isGenerativeModel)
    const generative = mergeDuplicateKeys(llmRecords)
    const discoveredModels = Object.fromEntries(
      generative.map((model) => [model.key, toModelConfig(model)]),
    )
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

    const result = {
      discovered: generative.length,
      discoveryPath: LM_STUDIO_MODELS_PATH,
      mergedDuplicates: llmRecords.length - generative.length,
      skippedEmbeddings: response.models.filter((model) => model.type === "embedding").length,
      skippedUnsupported: response.models.filter((model) => !isGenerativeModel(model) && model.type !== "embedding").length,
      serverURL,
      toolUse: {
        default: generative.filter((model) => toolUseMode(model) === "default").map((model) => model.key),
        native: generative.filter((model) => toolUseMode(model) === "native").map((model) => model.key),
        unknown: generative.filter((model) => toolUseMode(model) === "unknown").map((model) => model.key),
      },
    }
    await log("info", "Discovered LM Studio models", result)
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
