import { afterEach, describe, expect, it, vi } from "vitest"
import type { PluginInput } from "@opencode-ai/plugin"
import { LMStudioPlugin } from "../src/index.ts"
import type { OpenCodeConfig, PluginLogger } from "../src/types/index.ts"
import { enhanceConfig } from "../src/plugin/enhance-config.ts"
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

function model(overrides: Record<string, unknown> = {}) {
  return {
    id: "publisher/model",
    object: "model",
    type: "llm",
    publisher: "publisher",
    arch: "qwen3",
    compatibility_type: "gguf",
    quantization: "Q4_K_M",
    state: "not-loaded",
    max_context_length: 32_768,
    ...overrides,
  }
}

function modelsResponse(data: Array<Record<string, unknown>>) {
  return new Response(JSON.stringify({ object: "list", data }), {
    status: 200,
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

describe("LM Studio API", () => {
  it("normalizes provider URLs without guessing ports or hosts", () => {
    expect(normalizeLMStudioURL("http://127.0.0.1:1234/v1/")).toBe("http://127.0.0.1:1234")
    expect(toOpenAICompatibleURL("https://models.example.test/v1")).toBe("https://models.example.test/v1")
    expect(toModelsURL("https://models.example.test/v1")).toBe("https://models.example.test/api/v0/models")
  })

  it("rejects unsupported URL protocols", () => {
    expect(() => normalizeLMStudioURL("ws://127.0.0.1:1234")).toThrow(LMStudioAPIError)
  })

  it("uses the metadata-rich endpoint and forwards an explicit API key", async () => {
    const fetcher = vi.fn(async () => modelsResponse([model()]))

    const response = await discoverModels("https://models.example.test/v1", {
      apiKey: "secret",
      fetch: fetcher as typeof fetch,
    })

    expect(response.data).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledWith(
      "https://models.example.test/api/v0/models",
      expect.objectContaining({ headers: { Authorization: "Bearer secret" } }),
    )
  })

  it("rejects responses that omit official model metadata", async () => {
    const fetcher = vi.fn(async () => modelsResponse([{ id: "unknown/model" }]))

    await expect(discoverModels("http://127.0.0.1:1234", {
      fetch: fetcher as typeof fetch,
    })).rejects.toThrow("unsupported response")
  })

  it("auto-detects historical ports only after validating the official response", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("not LM Studio", { status: 200 }))
      .mockResolvedValueOnce(modelsResponse([model()]))
    vi.stubGlobal("fetch", fetcher)

    const detected = await autoDetectLMStudio()

    expect(detected?.serverURL).toBe("http://127.0.0.1:8080")
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("preserves private-network API-key fallback without leaking it to public hosts", () => {
    process.env.LMSTUDIO_API_KEY = "private-token"
    process.env.CUSTOM_LM_STUDIO_KEY = "explicit-token"

    expect(isLocalOrPrivateURL("http://127.0.0.1:1234/v1")).toBe(true)
    expect(isLocalOrPrivateURL("http://192.168.1.10:1234/v1")).toBe(true)
    expect(isLocalOrPrivateURL("http://[::1]:1234/v1")).toBe(true)
    expect(isLocalOrPrivateURL("https://models.example.test/v1")).toBe(false)
    expect(getLMStudioApiKey(undefined, "http://127.0.0.1:1234")).toBe("private-token")
    expect(getLMStudioApiKey(undefined, "https://models.example.test")).toBeUndefined()
    expect(getLMStudioApiKey("{env:CUSTOM_LM_STUDIO_KEY}", "https://models.example.test")).toBe("explicit-token")
  })
})

describe("config enhancement", () => {
  it("registers only typed generative models and skips embeddings", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => modelsResponse([
      model({ id: "plain-model-with-no-family-name" }),
      model({ id: "vision/model", type: "vlm", max_context_length: 65_536 }),
      model({ id: "embedding/model", type: "embeddings" }),
      model({ id: "future/model", type: "future-domain" }),
    ])))
    const value = config()

    const result = await enhanceConfig(value, logger())

    expect(result).toMatchObject({ discovered: 2, skippedEmbeddings: 1, skippedUnsupported: 1 })
    expect(value.provider?.lmstudio?.options?.baseURL).toBe("http://127.0.0.1:1234/v1")
    expect(value.provider?.lmstudio?.models).toEqual({
      "plain-model-with-no-family-name": expect.objectContaining({
        id: "plain-model-with-no-family-name",
        name: "plain-model-with-no-family-name",
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 32_768, output: 8_192 },
      }),
      "vision/model": expect.objectContaining({
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 65_536, output: 8_192 },
      }),
    })
    expect(value.provider?.lmstudio?.whitelist).toEqual([
      "plain-model-with-no-family-name",
      "vision/model",
    ])
  })

  it("omits limits when LM Studio does not report an official context length", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => modelsResponse([model({ max_context_length: undefined })])))
    const value = config()

    await enhanceConfig(value, logger())

    expect(value.provider?.lmstudio?.models?.["publisher/model"]).not.toHaveProperty("limit")
  })

  it("preserves explicit user model overrides", async () => {
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
      "https://models.example.test/api/v0/models",
      expect.objectContaining({ headers: { Authorization: "Bearer secret" } }),
    )
  })

  it("leaves config unchanged when the default LM Studio server is unavailable", async () => {
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

  it("does not let logging failures block configuration", async () => {
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
