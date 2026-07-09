import type { PluginInput } from "@opencode-ai/plugin"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LMStudioPlugin } from "../src/index.ts"
import {
  BADGE_TIERS,
  DEFAULT_BADGE_TIER,
  decorateModelName,
  effectiveContextLength,
  enhanceConfig,
  formatLabel,
  formatSize,
  modelBadge,
  resolveBadgeTier,
  toolUseMode,
  toModelConfig,
} from "../src/plugin/enhance-config.ts"
import type { LMStudioModel, OpenCodeConfig, PluginLogger } from "../src/types/index.ts"
import {
  LMStudioAPIError,
  autoDetectLMStudio,
  discoverModels,
  getLMStudioApiKey,
  isLocalOrPrivateURL,
  normalizeLMStudioURL,
  toModelsURL,
  toOpenAICompatibleURL,
} from "../src/utils/lmstudio-api.ts"

function model(overrides: Record<string, unknown> = {}): LMStudioModel {
  return {
    type: "llm",
    key: "publisher/model",
    display_name: "Publisher Model",
    publisher: "publisher",
    architecture: "qwen3",
    quantization: { name: "Q4_K_M", bits_per_weight: 4 },
    loaded_instances: [],
    max_context_length: 32_768,
    format: "gguf",
    capabilities: { vision: false, trained_for_tool_use: true },
    ...overrides,
  } as LMStudioModel
}

function embedding(key: string, loadedContext?: number): LMStudioModel {
  return model({
    type: "embedding",
    key,
    display_name: key,
    architecture: null,
    capabilities: undefined,
    loaded_instances: loadedContext
      ? [{ id: `${key}:loaded`, config: { context_length: loadedContext } }]
      : [],
    max_context_length: 2_048,
  })
}

function modelsResponse(models: Array<Record<string, unknown> | LMStudioModel>, status = 200) {
  return new Response(JSON.stringify({ models }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function config(value: OpenCodeConfig = {}): OpenCodeConfig {
  return value
}

function logger(): PluginLogger {
  return vi.fn(async () => undefined)
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.LMSTUDIO_API_KEY
  delete process.env.LM_API_TOKEN
  delete process.env.CUSTOM_LM_STUDIO_KEY
})

describe("LM Studio native API v1", () => {
  it("normalizes provider URLs onto the documented native and compatible endpoints", () => {
    expect(normalizeLMStudioURL("http://127.0.0.1:1234/v1/")).toBe("http://127.0.0.1:1234")
    expect(toOpenAICompatibleURL("https://models.example.test/v1")).toBe("https://models.example.test/v1")
    expect(toModelsURL("https://models.example.test/v1")).toBe("https://models.example.test/api/v1/models")
  })

  it("rejects unsupported URL protocols", () => {
    expect(() => normalizeLMStudioURL("ws://127.0.0.1:1234")).toThrow(LMStudioAPIError)
  })

  it("validates the native response and forwards an explicit API token", async () => {
    const fetcher = vi.fn(async () => modelsResponse([model()]))

    const response = await discoverModels("https://models.example.test/v1", {
      apiKey: "secret",
      fetch: fetcher as typeof fetch,
    })

    expect(response.models).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledWith(
      "https://models.example.test/api/v1/models",
      expect.objectContaining({ headers: { Authorization: "Bearer secret" } }),
    )
  })

  it("rejects HTTP-200 error bodies instead of treating status as endpoint support", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: "Unexpected endpoint" }), { status: 200 }))

    await expect(discoverModels("http://127.0.0.1:1234", {
      fetch: fetcher as typeof fetch,
    })).rejects.toThrow("unsupported response")
  })

  it.each([401, 403])("does not retry HTTP %i authentication failures against an older endpoint", async (status) => {
    const fetcher = vi.fn(async () => modelsResponse([], status))

    await expect(discoverModels("http://127.0.0.1:1234", {
      fetch: fetcher as typeof fetch,
    })).rejects.toThrow(`HTTP ${status}`)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:1234/api/v1/models",
      expect.any(Object),
    )
  })

  it("auto-detects only LM Studio's documented default local endpoint", async () => {
    const fetcher = vi.fn(async () => modelsResponse([model()]))
    vi.stubGlobal("fetch", fetcher)

    const detected = await autoDetectLMStudio()

    expect(detected?.serverURL).toBe("http://127.0.0.1:1234")
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it("limits automatic token lookup to local and private hosts", () => {
    process.env.LM_API_TOKEN = "official-token"
    process.env.LMSTUDIO_API_KEY = "compatibility-token"
    process.env.CUSTOM_LM_STUDIO_KEY = "explicit-token"

    expect(isLocalOrPrivateURL("http://127.0.0.1:1234/v1")).toBe(true)
    expect(isLocalOrPrivateURL("http://192.168.1.10:1234/v1")).toBe(true)
    expect(isLocalOrPrivateURL("http://[::1]:1234/v1")).toBe(true)
    expect(isLocalOrPrivateURL("https://models.example.test/v1")).toBe(false)
    expect(getLMStudioApiKey(undefined, "http://127.0.0.1:1234")).toBe("official-token")
    expect(getLMStudioApiKey(undefined, "https://models.example.test")).toBeUndefined()
    expect(getLMStudioApiKey("{env:CUSTOM_LM_STUDIO_KEY}", "https://models.example.test")).toBe("explicit-token")
  })
})

describe("model mapping", () => {
  it("uses the model maximum when unloaded and the conservative active minimum when loaded", () => {
    const unloaded = model({ max_context_length: 131_072 })
    const single = model({
      max_context_length: 131_072,
      loaded_instances: [{ id: "single", config: { context_length: 65_536 } }],
    })
    const multiple = model({
      max_context_length: 131_072,
      loaded_instances: [
        { id: "large", config: { context_length: 65_536 } },
        { id: "small", config: { context_length: 16_384 } },
      ],
    })

    expect(effectiveContextLength(unloaded)).toBe(131_072)
    expect(effectiveContextLength(single)).toBe(65_536)
    expect(effectiveContextLength(multiple)).toBe(16_384)
    expect(toModelConfig(multiple as LMStudioModel & { type: "llm" }).limit).toEqual({
      context: 16_384,
      output: 4_096,
    })
  })

  it("maps vision and tool support while preserving native-vs-default tool diagnostics", () => {
    const mapped = toModelConfig(model({
      key: "zai-org/glm-4.5v",
      display_name: "GLM 4.5V",
      capabilities: {
        vision: true,
        trained_for_tool_use: false,
        reasoning: { allowed_options: ["off", "on"], default: "on" },
      },
    }) as LMStudioModel & { type: "llm" })

    expect(mapped).toMatchObject({
      id: "zai-org/glm-4.5v",
      name: "GLM 4.5V (Q4_K_M · GGUF)",
      attachment: true,
      tool_call: true,
      modalities: { input: ["text", "image"], output: ["text"] },
    })
    expect(toolUseMode(model({ capabilities: { vision: false, trained_for_tool_use: true } }))).toBe("native")
    expect(toolUseMode(model({ capabilities: { vision: false, trained_for_tool_use: false } }))).toBe("default")
    expect(toolUseMode(model({ capabilities: undefined }))).toBe("unknown")
    expect(mapped).not.toHaveProperty("reasoning")
  })

  it("badges the display name with params, quant, size, and format", () => {
    const full = toModelConfig(model({
      display_name: "Devstral Small",
      params_string: "24B",
      quantization: { name: "Q4_K_M", bits_per_weight: 4 },
      size_bytes: 14_300_000_000,
      format: "mlx",
    }) as LMStudioModel & { type: "llm" })
    expect(full.name).toBe("Devstral Small (24B · Q4_K_M · 14.3 GB · MLX)")

    // Each segment drops out cleanly when LM Studio does not report it.
    const bare = toModelConfig(model({
      display_name: "Devstral Small",
      params_string: null,
      quantization: null,
      size_bytes: null,
      format: null,
    }) as LMStudioModel & { type: "llm" })
    expect(bare.name).toBe("Devstral Small")

    const partial = model({
      display_name: "Devstral Small",
      params_string: "7B",
      quantization: null,
      size_bytes: undefined,
      format: "gguf",
    })
    expect(modelBadge(partial)).toBe("7B · GGUF")
    expect(decorateModelName("Devstral Small", partial)).toBe("Devstral Small (7B · GGUF)")
  })

  it("formats size with LM Studio's decimal convention and format labels", () => {
    expect(formatSize(14_300_000_000)).toBe("14.3 GB")
    expect(formatSize(634_550_000)).toBe("635 MB")
    expect(formatSize(84_110_000)).toBe("84 MB")
    // KB tier (real models are never this small, but the branch exists).
    expect(formatSize(512_000)).toBe("512 KB")
    expect(formatSize(1_000)).toBe("1 KB")
    // Unit-boundary promotion: a value that would round to "1000 <unit>"
    // promotes to the larger unit instead of showing four digits.
    expect(formatSize(999_999_999)).toBe("1.0 GB")
    expect(formatSize(999_500_000)).toBe("1.0 GB")
    expect(formatSize(999_499_999)).toBe("999 MB")
    expect(formatSize(999_999)).toBe("1 MB")
    expect(formatSize(999_499)).toBe("999 KB")
    expect(formatSize(0)).toBeUndefined()
    expect(formatSize(null)).toBeUndefined()
    expect(formatSize(undefined)).toBeUndefined()
    expect(formatLabel("mlx")).toBe("MLX")
    expect(formatLabel("gguf")).toBe("GGUF")
    expect(formatLabel(null)).toBeUndefined()
  })

  it("selects badge segments per tier as order-preserving subsets", () => {
    const full = model({
      display_name: "Devstral Small",
      params_string: "24B",
      quantization: { name: "Q4_K_M", bits_per_weight: 4 },
      size_bytes: 14_300_000_000,
      format: "mlx",
    })

    expect(modelBadge(full, "off")).toBeUndefined()
    expect(modelBadge(full, "format")).toBe("MLX")
    expect(modelBadge(full, "compact")).toBe("Q4_K_M · 14.3 GB · MLX")
    expect(modelBadge(full, "full")).toBe("24B · Q4_K_M · 14.3 GB · MLX")
    // Default tier is full.
    expect(modelBadge(full)).toBe(modelBadge(full, "full"))
    expect(DEFAULT_BADGE_TIER).toBe("full")
    expect(BADGE_TIERS).toEqual(["off", "format", "compact", "full"])

    // Segments still drop within a tier when a field is missing.
    const noQuant = model({ display_name: "X", params_string: "24B", quantization: null, size_bytes: 14_300_000_000, format: "mlx" })
    expect(modelBadge(noQuant, "compact")).toBe("14.3 GB · MLX")
    // format tier with unknown format yields no badge.
    expect(modelBadge(model({ format: null }), "format")).toBeUndefined()

    // toModelConfig / decorateModelName honour the tier.
    expect(toModelConfig(full as LMStudioModel & { type: "llm" }, "off").name).toBe("Devstral Small")
    expect(toModelConfig(full as LMStudioModel & { type: "llm" }, "format").name).toBe("Devstral Small (MLX)")
    expect(decorateModelName("Devstral Small", full, "compact")).toBe("Devstral Small (Q4_K_M · 14.3 GB · MLX)")
  })

  it("resolves the badge option, failing open to the default tier", () => {
    expect(resolveBadgeTier("off")).toBe("off")
    expect(resolveBadgeTier("format")).toBe("format")
    expect(resolveBadgeTier("compact")).toBe("compact")
    expect(resolveBadgeTier("full")).toBe("full")
    // Invalid / wrong-typed values degrade to the default rather than throwing.
    expect(resolveBadgeTier("bogus")).toBe(DEFAULT_BADGE_TIER)
    expect(resolveBadgeTier(undefined)).toBe(DEFAULT_BADGE_TIER)
    expect(resolveBadgeTier(null)).toBe(DEFAULT_BADGE_TIER)
    expect(resolveBadgeTier(42)).toBe(DEFAULT_BADGE_TIER)
    expect(resolveBadgeTier({ tier: "compact" })).toBe(DEFAULT_BADGE_TIER)
    expect(resolveBadgeTier("")).toBe(DEFAULT_BADGE_TIER)
  })
})

describe("config enhancement", () => {
  it("registers Nemotron and GLM from typed records without name heuristics", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => modelsResponse([
      model({
        key: "nvidia/nemotron-3-nano-omni",
        display_name: "Nemotron 3 Nano Omni",
        capabilities: { vision: false, trained_for_tool_use: false },
      }),
      model({
        key: "zai-org/glm-4.5v",
        display_name: "GLM 4.5V",
        capabilities: { vision: true, trained_for_tool_use: true },
      }),
      embedding("embedding/unloaded"),
      embedding("embedding/loaded", 1_024),
      model({ type: "future-domain", key: "future/model", display_name: "Future Model" }),
    ])))
    const value = config()
    const log = logger()

    const result = await enhanceConfig(value, log)

    expect(result).toMatchObject({
      discovered: 2,
      skippedEmbeddings: 2,
      skippedUnsupported: 1,
      toolUse: {
        default: ["nvidia/nemotron-3-nano-omni"],
        native: ["zai-org/glm-4.5v"],
        unknown: [],
      },
    })
    expect(log).toHaveBeenCalledWith(
      "info",
      "Discovered LM Studio models",
      expect.objectContaining({ toolUse: result?.toolUse }),
    )
    expect(value.provider?.lmstudio?.options?.baseURL).toBe("http://127.0.0.1:1234/v1")
    expect(value.provider?.lmstudio?.models).toEqual({
      "nvidia/nemotron-3-nano-omni": expect.objectContaining({
        name: "Nemotron 3 Nano Omni (Q4_K_M · GGUF)",
        attachment: false,
        tool_call: true,
        modalities: { input: ["text"], output: ["text"] },
      }),
      "zai-org/glm-4.5v": expect.objectContaining({
        name: "GLM 4.5V (Q4_K_M · GGUF)",
        attachment: true,
        tool_call: true,
        modalities: { input: ["text", "image"], output: ["text"] },
      }),
    })
    expect(value.provider?.lmstudio?.whitelist).toEqual([
      "nvidia/nemotron-3-nano-omni",
      "zai-org/glm-4.5v",
    ])
  })

  it("replaces stale generated models and whitelist entries on a later config load", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(modelsResponse([
        model({ key: "model/removed", display_name: "Removed" }),
        model({ key: "model/retained", display_name: "Retained" }),
      ]))
      .mockResolvedValueOnce(modelsResponse([
        model({ key: "model/retained", display_name: "Retained" }),
        model({ key: "model/added", display_name: "Added" }),
      ]))
    vi.stubGlobal("fetch", fetcher)
    const value = config()

    await enhanceConfig(value, logger())
    await enhanceConfig(value, logger())

    expect(Object.keys(value.provider?.lmstudio?.models ?? {})).toEqual(["model/retained", "model/added"])
    expect(value.provider?.lmstudio?.whitelist).toEqual(["model/retained", "model/added"])
  })

  it("clears the generated model set when no chat models remain", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(modelsResponse([model({ key: "model/removed", display_name: "Removed" })]))
      .mockResolvedValueOnce(modelsResponse([embedding("embedding/only")]))
    vi.stubGlobal("fetch", fetcher)
    const value = config()

    await enhanceConfig(value, logger())
    await enhanceConfig(value, logger())

    expect(value.provider?.lmstudio?.models).toEqual({})
    expect(value.provider?.lmstudio?.whitelist).toEqual([])
  })

  it("preserves explicit model overrides and whitelists across discovery changes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => modelsResponse([model()])))
    const value = config({
      provider: {
        lmstudio: {
          options: { baseURL: "https://models.example.test/v1", apiKey: "secret" },
          models: {
            "publisher/model": { name: "My explicit name", limit: { context: 4_096, output: 1_024 } },
          },
          whitelist: ["publisher/model"],
        },
      },
    })

    await enhanceConfig(value, logger())

    expect(value.provider?.lmstudio?.models?.["publisher/model"]).toEqual({
      name: "My explicit name",
      limit: { context: 4_096, output: 1_024 },
    })
    expect(value.provider?.lmstudio?.whitelist).toEqual(["publisher/model"])
    expect(fetch).toHaveBeenCalledWith(
      "https://models.example.test/api/v1/models",
      expect.objectContaining({ headers: { Authorization: "Bearer secret" } }),
    )
  })

  it("honours options.badge tiers and preserves the option idempotently", async () => {
    const badged = model({
      key: "publisher/model",
      display_name: "Devstral Small",
      params_string: "24B",
      size_bytes: 14_300_000_000,
      quantization: { name: "Q4_K_M", bits_per_weight: 4 },
      format: "mlx",
    })

    // "off" → bare display name.
    const off = config({ provider: { lmstudio: { options: { baseURL: "http://127.0.0.1:1234/v1", badge: "off" } } } })
    vi.stubGlobal("fetch", vi.fn(async () => modelsResponse([badged])))
    await enhanceConfig(off, logger())
    expect(off.provider?.lmstudio?.models?.["publisher/model"]?.name).toBe("Devstral Small")

    // "compact" drops params; runs twice to prove the option is not stripped
    // (options is the persistent store, so a strip would revert to full on
    // the second config load).
    const compact = config({ provider: { lmstudio: { options: { baseURL: "http://127.0.0.1:1234/v1", badge: "compact" } } } })
    vi.stubGlobal("fetch", vi.fn(async () => modelsResponse([badged])))
    await enhanceConfig(compact, logger())
    await enhanceConfig(compact, logger())
    expect(compact.provider?.lmstudio?.options?.badge).toBe("compact")
    expect(compact.provider?.lmstudio?.options?.baseURL).toBe("http://127.0.0.1:1234/v1")
    expect(compact.provider?.lmstudio?.models?.["publisher/model"]?.name)
      .toBe("Devstral Small (Q4_K_M · 14.3 GB · MLX)")

    // Invalid value degrades to the default (full) instead of breaking startup.
    const bogus = config({ provider: { lmstudio: { options: { baseURL: "http://127.0.0.1:1234/v1", badge: "nope" } } } })
    vi.stubGlobal("fetch", vi.fn(async () => modelsResponse([badged])))
    await enhanceConfig(bogus, logger())
    expect(bogus.provider?.lmstudio?.models?.["publisher/model"]?.name)
      .toBe("Devstral Small (24B · Q4_K_M · 14.3 GB · MLX)")
  })

  it("preserves an explicitly empty whitelist", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => modelsResponse([model()])))
    const value = config({
      provider: {
        lmstudio: {
          options: { baseURL: "http://127.0.0.1:1234/v1" },
          whitelist: [],
        },
      },
    })

    await enhanceConfig(value, logger())
    await enhanceConfig(value, logger())

    expect(value.provider?.lmstudio?.whitelist).toEqual([])
  })

  it("leaves config unchanged when the default server is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline") }))
    const value = config()
    const log = logger()

    await expect(enhanceConfig(value, log)).resolves.toBeUndefined()

    expect(value).toEqual({})
    expect(log).toHaveBeenCalledWith("debug", "LM Studio model discovery unavailable", expect.any(Object))
  })
})

describe("plugin entrypoint", () => {
  it("returns the config hook and uses OpenCode structured logging", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => modelsResponse([model()])))
    const appLog = vi.fn(async () => ({ data: true }))
    const input = {
      client: { app: { log: appLog } },
    } as unknown as PluginInput

    const hooks = await LMStudioPlugin(input)
    const value = config()
    await hooks.config?.(value)

    expect(hooks.config).toBeTypeOf("function")
    expect(value.provider?.lmstudio?.models?.["publisher/model"]).toBeDefined()
    expect(appLog).toHaveBeenCalledWith({
      body: expect.objectContaining({
        service: "opencode-lmstudio",
        level: "info",
        message: "LM Studio plugin initialized",
      }),
    })
  })

  it("keeps configuration available when logging fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => modelsResponse([model()])))
    const input = {
      client: { app: { log: vi.fn(async () => { throw new Error("logging unavailable") }) } },
    } as unknown as PluginInput

    const hooks = await LMStudioPlugin(input)
    const value = config()
    await expect(hooks.config?.(value)).resolves.toBeUndefined()
    expect(value.provider?.lmstudio).toBeDefined()
  })
})
