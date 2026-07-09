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

/** Verbosity of the model-name metadata badge, set via `options.badge`. */
export const BADGE_TIERS = ["off", "format", "compact", "full"] as const
export type BadgeTier = (typeof BADGE_TIERS)[number]
export const DEFAULT_BADGE_TIER: BadgeTier = "full"

/**
 * Separator between badge segments. A single named constant (U+00B7 MIDDLE DOT)
 * so it is swappable in one place if a terminal renders it poorly; deliberately
 * not a config option, to keep the provider-options surface minimal.
 */
const BADGE_SEPARATOR = " · "

/**
 * Resolve the user's `options.badge` value to a known tier, failing open to the
 * default so a typo never breaks OpenCode startup (matching the plugin's
 * discovery-error-degrades ethos). Only the string enum is accepted; anything
 * else (object, number, null, undefined) falls back to the default.
 */
export function resolveBadgeTier(raw: unknown): BadgeTier {
  return typeof raw === "string" && (BADGE_TIERS as readonly string[]).includes(raw)
    ? (raw as BadgeTier)
    : DEFAULT_BADGE_TIER
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

/** Human-facing tag for LM Studio's runtime format, or undefined when unknown. */
export function formatLabel(format: LMStudioModel["format"]): string | undefined {
  return format === "mlx" ? "MLX" : format === "gguf" ? "GGUF" : undefined
}

/**
 * Compact on-disk size using LM Studio's decimal (base-1000) convention. Unit
 * gates sit at 999.5 (not 1000) so a value that the next-smaller unit would
 * round up to a 4-digit "1000" promotes to the larger unit instead — e.g.
 * 999_999_999 reads "1.0 GB", not "1000 MB".
 */
export function formatSize(bytes: number | null | undefined): string | undefined {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return undefined
  if (bytes >= 999.5e6) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 999.5e3) return `${Math.round(bytes / 1e6)} MB`
  return `${Math.round(bytes / 1e3)} KB`
}

/**
 * Build the metadata badge appended to a model's display name. The tier selects
 * an order-preserving subset of `params · quant · size · format`:
 *
 *   off     → no badge
 *   format  → `GGUF` / `MLX`
 *   compact → `Q4_K_M · 16.5 GB · GGUF`        (drops params)
 *   full    → `27B · Q4_K_M · 16.5 GB · GGUF`  (default)
 *
 * `compact` drops params because params is identical across the quant/format
 * siblings of one model, so it never disambiguates them — it only informs.
 * Within a tier, each segment is still dropped when LM Studio does not report
 * it, so the badge degrades cleanly on older servers. Returns undefined when
 * the tier is `off` or nothing is known.
 */
export function modelBadge(model: LMStudioModel, tier: BadgeTier = DEFAULT_BADGE_TIER): string | undefined {
  if (tier === "off") return undefined
  const params = getString(model.params_string)      // "27B"
  const quant = getString(model.quantization?.name)  // "Q4_K_M"
  const size = formatSize(model.size_bytes)          // "16.5 GB"
  const format = formatLabel(model.format)           // "MLX" | "GGUF"
  const segments =
    tier === "format" ? [format]
      : tier === "compact" ? [quant, size, format]
        : [params, quant, size, format]
  const shown = segments.filter((segment): segment is string => segment !== undefined)
  return shown.length > 0 ? shown.join(BADGE_SEPARATOR) : undefined
}

/**
 * Append the metadata badge to the display name so the OpenCode model picker
 * distinguishes otherwise-identical builds. An MLX quant and its GGUF sibling,
 * or two quant levels of one model, usually share a `display_name`; the badge
 * makes size, quant, and runtime visible in the list and tooltip.
 */
export function decorateModelName(displayName: string, model: LMStudioModel, tier: BadgeTier = DEFAULT_BADGE_TIER): string {
  const badge = modelBadge(model, tier)
  return badge ? `${displayName} (${badge})` : displayName
}

export function toModelConfig(model: LMStudioModel & { type: "llm" }, badge: BadgeTier = DEFAULT_BADGE_TIER): ModelConfig {
  const vision = model.capabilities?.vision === true
  const input: Array<"text" | "image"> = vision ? ["text", "image"] : ["text"]
  const context = effectiveContextLength(model)

  return {
    id: model.key,
    name: decorateModelName(model.display_name, model, badge),
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
    // `options.badge` is a plugin-only key read in enhanceConfig. It is left in
    // the forwarded options on purpose: `@ai-sdk/openai-compatible` reads only
    // named fields and silently ignores unknown keys (never sent on the wire),
    // and `options` is the one config record that persists across repeated
    // config-hook runs, so stripping badge here would drop the user's tier on
    // the next load (the same reason apiKey below is written back into options).
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
    const badgeTier = resolveBadgeTier(existing?.options?.badge)
    const response = detected?.response ?? await discoverModels(serverURL, { apiKey })
    const generative = response.models.filter(isGenerativeModel)
    const discoveredModels = Object.fromEntries(
      generative.map((model) => [model.key, toModelConfig(model, badgeTier)]),
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
