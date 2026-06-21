import type { PluginInput } from "@opencode-ai/plugin"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LMStudioPlugin } from "../src/index.ts"
import {
  effectiveContextLength,
  enhanceConfig,
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
      name: "GLM 4.5V",
      attachment: true,
      tool_call: true,
      modalities: { input: ["text", "image"], output: ["text"] },
    })
    expect(toolUseMode(model({ capabilities: { vision: false, trained_for_tool_use: true } }))).toBe("native")
    expect(toolUseMode(model({ capabilities: { vision: false, trained_for_tool_use: false } }))).toBe("default")
    expect(toolUseMode(model({ capabilities: undefined }))).toBe("unknown")
    expect(mapped).not.toHaveProperty("reasoning")
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
        name: "Nemotron 3 Nano Omni",
        attachment: false,
        tool_call: true,
        modalities: { input: ["text"], output: ["text"] },
      }),
      "zai-org/glm-4.5v": expect.objectContaining({
        name: "GLM 4.5V",
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
