import { describe, it, expect } from "vitest";
import {
  discoverModels,
  getDiscoveryStore,
  formatModelsTable,
} from "../src/discover";
import type { DiscoverySnapshot } from "../src/discover";

/**
 * Helper: route fetch calls to handlers based on URL pattern.
 */
function setupFetchRouter(
  routes: Record<
    string,
    | { ok: boolean; status?: number; body?: unknown }
    | (() => { ok: boolean; status?: number; body?: unknown })
    | "reject"
  >,
) {
  mockFetch.mockImplementation(async (url: string) => {
    for (const [pattern, handler] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        if (handler === "reject") {
          throw new Error("ECONNREFUSED");
        }
        const resolved = typeof handler === "function" ? handler() : handler;
        if (!resolved.ok) {
          return { ok: false, status: resolved.status ?? 500 };
        }
        return { ok: true, json: async () => resolved.body };
      }
    }
    return { ok: false, status: 404 };
  });
}

describe("discoverModels", () => {
  it("should discover models from OpenAI-compatible provider", async () => {
    setupFetchRouter({
      "/v1/models": {
        ok: true,
        body: {
          object: "list",
          data: [
            {
              id: "qwen3-30b-a3b",
              object: "model",
              created: 1700000000,
              owned_by: "local",
            },
          ],
        },
      },
    });

    const config: Record<string, unknown> = {
      provider: {
        "my-provider": {
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: "http://localhost:8000/v1",
          },
        },
      },
    };

    await discoverModels(config);

    const providers = config.provider as Record<
      string,
      Record<string, unknown>
    >;
    const models = providers["my-provider"].models as Record<string, unknown>;
    expect(models["qwen3-30b-a3b"]).toBeDefined();

    const store = getDiscoveryStore();
    expect(store).toHaveLength(1);
    expect(store[0].provider).toBe("my-provider");
  });

  it("keeps valid models when the list contains malformed siblings", async () => {
    setupFetchRouter({
      "/v1/models": {
        ok: true,
        body: {
          data: [
            null,
            42,
            "invalid",
            {},
            { id: "" },
            { id: "valid-model", owned_by: "local" },
          ],
        },
      },
    });
    const config: Record<string, unknown> = {
      provider: {
        generic: {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: "https://actualyze.test/v1" },
        },
      },
    };

    await discoverModels(config);

    const providers = config.provider as Record<
      string,
      Record<string, unknown>
    >;
    const models = providers.generic.models as Record<string, unknown>;
    expect(Object.keys(models)).toEqual(["valid-model"]);
  });

  it("supports reserved property names as literal discovered Actualyze model IDs", async () => {
    const ids = ["constructor", "__proto__"];
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/v1/models")) {
        return {
          ok: true,
          json: async () => ({
            data: ids.map((id) => ({ id, owned_by: "atlas" })),
          }),
        };
      }
      const id = decodeURIComponent(url.split("/").at(-1) ?? "");
      return {
        ok: true,
        json: async () => ({
          id,
          object: "model",
          created: 1_700_000_000,
          owned_by: "atlas",
          context_window: 4096,
          max_output_tokens: 1024,
          capabilities: {
            vision: false,
            tool_use: false,
            thinking: false,
            thinking_adaptive: false,
          },
        }),
      };
    });
    const config: Record<string, unknown> = {
      provider: {
        actualyze: {
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: "https://actualyze.test/v1",
            probe: "auto",
          },
        },
      },
    };

    await discoverModels(config);

    const providers = config.provider as Record<
      string,
      Record<string, unknown>
    >;
    const models = providers.actualyze.models as Record<
      string,
      Record<string, unknown>
    >;
    for (const id of ids) {
      expect(Object.hasOwn(models, id)).toBe(true);
      expect(models[id].id).toBe(id);
      expect(models[id].limit).toEqual({ context: 4096, output: 1024 });
    }
  });

  it("should enrich models with oMLX probe", async () => {
    setupFetchRouter({
      "/v1/models/status": {
        ok: true,
        body: {
          models: [
            {
              id: "qwen3-30b-a3b",
              loaded: true,
              model_type: "llm",
              max_context_window: 131072,
              max_tokens: 32768,
            },
          ],
        },
      },
      "/v1/models": {
        ok: true,
        body: {
          object: "list",
          data: [
            {
              id: "qwen3-30b-a3b",
              object: "model",
              created: 1700000000,
              owned_by: "local",
            },
          ],
        },
      },
    });

    const config: Record<string, unknown> = {
      provider: {
        "omlx-local": {
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: "http://localhost:8000/v1",
            probe: "omlx",
          },
        },
      },
    };

    await discoverModels(config);

    const providers = config.provider as Record<
      string,
      Record<string, unknown>
    >;
    const models = providers["omlx-local"].models as Record<
      string,
      Record<string, unknown>
    >;
    const model = models["qwen3-30b-a3b"];
    expect(model).toBeDefined();
    expect(model.limit).toEqual({ context: 131072, output: 32768 });
    expect(model.modalities).toEqual({ input: ["text"], output: ["text"] });
    // temperature is set as default by the orchestrator, not individual probes
    expect(model.temperature).toBe(true);
  });

  it("should not emit null limits for oMLX virtual models", async () => {
    setupFetchRouter({
      "/v1/models/status": {
        ok: true,
        body: {
          models: [
            {
              id: "MarkItDown",
              loaded: true,
              model_type: "markitdown",
              max_context_window: null,
              max_tokens: null,
              estimated_size: null,
            },
          ],
        },
      },
      "/v1/models": {
        ok: true,
        body: {
          object: "list",
          data: [
            {
              id: "MarkItDown",
              object: "model",
              created: 1700000000,
              owned_by: "omlx",
              max_model_len: null,
            },
          ],
        },
      },
    });

    const config: Record<string, unknown> = {
      provider: {
        "omlx-local": {
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: "http://localhost:8000/v1",
            probe: "omlx",
          },
        },
      },
    };

    await discoverModels(config);

    const providers = config.provider as Record<
      string,
      Record<string, unknown>
    >;
    const models = providers["omlx-local"].models as Record<
      string,
      Record<string, unknown>
    >;

    expect(models["MarkItDown"]).toBeDefined();
    expect(models["MarkItDown"].limit).toBeUndefined();
    expect(models["MarkItDown"].sizeBytes).toBeUndefined();
  });

  it("should not emit non-finite limits from probe metadata", async () => {
    setupFetchRouter({
      "/v1/models/status": {
        ok: true,
        body: {
          models: [
            {
              id: "unstable-metadata",
              loaded: true,
              model_type: "llm",
              max_context_window: Number.POSITIVE_INFINITY,
              max_tokens: Number.NaN,
              estimated_size: Number.NEGATIVE_INFINITY,
            },
          ],
        },
      },
      "/v1/models": {
        ok: true,
        body: {
          object: "list",
          data: [
            {
              id: "unstable-metadata",
              object: "model",
              created: 1700000000,
              owned_by: "omlx",
            },
          ],
        },
      },
    });

    const config: Record<string, unknown> = {
      provider: {
        "omlx-local": {
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: "http://localhost:8000/v1",
            probe: "omlx",
          },
        },
      },
    };

    await discoverModels(config);

    const providers = config.provider as Record<
      string,
      Record<string, unknown>
    >;
    const models = providers["omlx-local"].models as Record<
      string,
      Record<string, unknown>
    >;

    expect(models["unstable-metadata"].limit).toBeUndefined();
    expect(models["unstable-metadata"].sizeBytes).toBeUndefined();
  });

  it("should not run probe when options.probe is not set", async () => {
    setupFetchRouter({
      "/v1/models": {
        ok: true,
        body: {
          object: "list",
          data: [
            {
              id: "some-model",
              object: "model",
              created: 1700000000,
              owned_by: "local",
            },
          ],
        },
      },
    });

    const config: Record<string, unknown> = {
      provider: {
        "no-probe": {
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: "http://localhost:8000/v1",
          },
        },
      },
    };

    await discoverModels(config);

    // Verify no probe-specific endpoints were called
    const calls = mockFetch.mock.calls.map((c) => c[0] as string);
    expect(calls.some((u) => u.includes("/models/status"))).toBe(false);
    expect(calls.some((u) => u.includes("/api/tags"))).toBe(false);
    expect(calls.some((u) => u.includes("/api/show"))).toBe(false);
  });

  it("should handle probe failure without breaking discovery", async () => {
    setupFetchRouter({
      "/v1/models/status": {
        ok: false,
        status: 500,
      },
      "/v1/models": {
        ok: true,
        body: {
          object: "list",
          data: [
            {
              id: "qwen3-30b",
              object: "model",
              created: 1700000000,
              owned_by: "local",
            },
          ],
        },
      },
    });

    const config: Record<string, unknown> = {
      provider: {
        "my-provider": {
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: "http://localhost:8000/v1",
            probe: "omlx",
          },
        },
      },
    };

    await discoverModels(config);

    const providers = config.provider as Record<
      string,
      Record<string, unknown>
    >;
    const models = providers["my-provider"].models as Record<string, unknown>;
    // Model still discovered, just no enrichment
    expect(models["qwen3-30b"]).toBeDefined();
  });

  it("should not modify manually configured models", async () => {
    setupFetchRouter({
      "/v1/models/status": {
        ok: true,
        body: {
          models: [
            {
              id: "manually-configured",
              loaded: true,
              model_type: "llm",
              max_context_window: 131072,
              max_tokens: 32768,
            },
          ],
        },
      },
      "/v1/models": {
        ok: true,
        body: {
          object: "list",
          data: [
            {
              id: "manually-configured",
              object: "model",
              created: 1700000000,
              owned_by: "local",
            },
            {
              id: "discovered-model",
              object: "model",
              created: 1700000000,
              owned_by: "local",
            },
          ],
        },
      },
    });

    const existingModelConfig = {
      id: "manually-configured",
      name: "My Custom Config",
      limit: { context: 4096, output: 1024 },
    };

    const config: Record<string, unknown> = {
      provider: {
        "my-provider": {
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: "http://localhost:8000/v1",
            probe: "omlx",
          },
          models: {
            "manually-configured": existingModelConfig,
          },
        },
      },
    };

    await discoverModels(config);

    const providers = config.provider as Record<
      string,
      Record<string, unknown>
    >;
    const models = providers["my-provider"].models as Record<
      string,
      Record<string, unknown>
    >;

    // Manually configured model should NOT be overwritten
    expect(models["manually-configured"]).toBe(existingModelConfig);
    expect(models["manually-configured"].name).toBe("My Custom Config");
    expect(models["manually-configured"].limit).toEqual({
      context: 4096,
      output: 1024,
    });

    // But the new model should be discovered
    expect(models["discovered-model"]).toBeDefined();

    // Discovery store should track the skipped model
    const store = getDiscoveryStore();
    expect(store[0].skipped).toEqual(["manually-configured"]);
  });

  it("should skip non-OpenAI-compatible providers", async () => {
    const config: Record<string, unknown> = {
      provider: {
        anthropic: {
          npm: "@ai-sdk/anthropic",
          options: {
            apiKey: "sk-test",
          },
        },
      },
    };

    await discoverModels(config);

    // No fetch calls should have been made
    expect(mockFetch).not.toHaveBeenCalled();

    const store = getDiscoveryStore();
    expect(store).toHaveLength(0);
  });

  it("should handle offline providers gracefully", async () => {
    setupFetchRouter({
      "/v1/models": "reject",
    });

    const config: Record<string, unknown> = {
      provider: {
        "offline-provider": {
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: "http://localhost:9999/v1",
          },
        },
      },
    };

    // Should not throw
    await discoverModels(config);

    const store = getDiscoveryStore();
    expect(store).toHaveLength(0);
  });

  it('should auto-detect and run probe when probe is "auto"', async () => {
    setupFetchRouter({
      "/v1/models": {
        ok: true,
        body: {
          object: "list",
          data: [
            {
              id: "meta-llama/Llama-3-8B",
              object: "model",
              created: 1700000000,
              owned_by: "vllm",
              max_model_len: 8192,
            },
          ],
        },
      },
    });

    const config: Record<string, unknown> = {
      provider: {
        "vllm-provider": {
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: "http://localhost:8000/v1",
            probe: "auto",
          },
        },
      },
    };

    await discoverModels(config);

    const providers = config.provider as Record<
      string,
      Record<string, unknown>
    >;
    const models = providers["vllm-provider"].models as Record<
      string,
      Record<string, unknown>
    >;
    const model = models["meta-llama/Llama-3-8B"];
    expect(model).toBeDefined();
    expect(model.limit).toEqual({ context: 8192 });
  });

  it("should auto-detect Actualyze and enrich discovered model capabilities", async () => {
    const id = "actualyze/model:latest";
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/v1/models")) {
        return {
          ok: true,
          json: async () => ({
            object: "list",
            data: [
              {
                id,
                object: "model",
                created: 1_700_000_000,
                owned_by: "atlas",
              },
            ],
          }),
        };
      }
      if (url.endsWith("/v1/models/actualyze%2Fmodel%3Alatest")) {
        return {
          ok: true,
          json: async () => ({
            id,
            object: "model",
            created: 1_700_000_000,
            owned_by: "atlas",
            context_window: 131_072,
            max_output_tokens: 16_384,
            capabilities: {
              vision: true,
              tool_use: true,
              thinking: true,
              thinking_adaptive: false,
            },
          }),
        };
      }
      return { ok: false, status: 404 };
    });

    const config: Record<string, unknown> = {
      provider: {
        actualyze: {
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: "https://actualyze.test/openai/v1",
            probe: "auto",
          },
        },
      },
    };

    await discoverModels(config);

    const providers = config.provider as Record<
      string,
      Record<string, unknown>
    >;
    const models = providers.actualyze.models as Record<
      string,
      Record<string, unknown>
    >;
    expect(models[id]).toMatchObject({
      limit: { context: 131_072, output: 16_384 },
      modalities: { input: ["text", "image"], output: ["text"] },
      attachment: true,
      tool_call: true,
      reasoning: true,
    });
  });

  it("should auto-detect a mixed Actualyze catalog and probe only Actualyze-owned entries", async () => {
    const actualyzeId = "actualyze/model:latest";
    const foreignId = "foreign-model";
    const falseId = "actualyze-disabled";
    const failedId = "actualyze-failed";
    const limitedId = "actualyze-limited";
    const spoofedId = "actualyze-spoofed";
    const detailUrls: string[] = [];
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/v1/models")) {
        return {
          ok: true,
          json: async () => ({
            object: "list",
            data: [
              {
                id: actualyzeId,
                object: "model",
                created: 1,
                owned_by: "atlas",
              },
              { id: foreignId, object: "model", created: 1, owned_by: "vllm" },
              { id: falseId, object: "model", created: 1, owned_by: "atlas" },
              { id: failedId, object: "model", created: 1, owned_by: "atlas" },
              { id: limitedId, object: "model", created: 1, owned_by: "atlas" },
              { id: spoofedId, object: "model", created: 1, owned_by: "atlas" },
            ],
          }),
        };
      }

      detailUrls.push(url);
      const id = decodeURIComponent(url.split("/").at(-1) ?? "");
      if (id === failedId) throw new Error("ECONNRESET");
      if (id === limitedId) return { ok: false, status: 429 };
      if (id === spoofedId) {
        return {
          ok: true,
          json: async () => ({
            id: "different-model",
            object: "model",
            created: 1,
            owned_by: "atlas",
            capabilities: {},
          }),
        };
      }
      const capabilities =
        id === falseId
          ? {
              vision: false,
              tool_use: false,
              thinking: false,
              thinking_adaptive: false,
            }
          : {
              vision: true,
              tool_use: true,
              thinking: true,
              thinking_adaptive: false,
            };
      return {
        ok: true,
        json: async () => ({
          id,
          object: "model",
          created: 1,
          owned_by: "atlas",
          context_window: 131_072,
          max_output_tokens: 16_384,
          capabilities,
        }),
      };
    });

    const config: Record<string, unknown> = {
      provider: {
        actualyze: {
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: "https://actualyze.test/openai/v1",
            probe: "auto",
          },
        },
      },
    };
    const fallbackMeta = {
      toolCall: true,
      reasoning: true,
      attachment: true,
      temperature: true,
      modalities: { input: ["text", "image"], output: ["text"] },
    };
    const modelsDevIndex = [
      foreignId,
      falseId,
      failedId,
      limitedId,
      spoofedId,
    ].map((id) => ({ id, normalized: id, meta: fallbackMeta }));

    await discoverModels(config, modelsDevIndex);

    const providers = config.provider as Record<
      string,
      Record<string, unknown>
    >;
    const models = providers.actualyze.models as Record<
      string,
      Record<string, unknown>
    >;
    expect(Object.keys(models)).toEqual([
      actualyzeId,
      foreignId,
      falseId,
      failedId,
      limitedId,
      spoofedId,
    ]);
    expect(models[actualyzeId]).toMatchObject({
      limit: { context: 131_072, output: 16_384 },
      modalities: { input: ["text", "image"], output: ["text"] },
      attachment: true,
      tool_call: true,
      reasoning: true,
    });
    const fallbackOutput = {
      tool_call: true,
      reasoning: true,
      attachment: true,
      temperature: true,
      modalities: { input: ["text", "image"], output: ["text"] },
    };
    expect(models[foreignId]).toMatchObject(fallbackOutput);
    expect(models[foreignId].limit).toBeUndefined();
    expect(models[falseId].tool_call).toBeUndefined();
    expect(models[falseId].reasoning).toBeUndefined();
    expect(models[falseId].attachment).toBeUndefined();
    expect(models[failedId]).toMatchObject(fallbackOutput);
    expect(models[failedId].limit).toBeUndefined();
    expect(models[limitedId]).toMatchObject(fallbackOutput);
    expect(models[limitedId].limit).toBeUndefined();
    expect(models[spoofedId]).toMatchObject(fallbackOutput);
    expect(models[spoofedId].limit).toBeUndefined();

    expect(detailUrls).toHaveLength(5);
    expect(detailUrls).toContain(
      "https://actualyze.test/openai/v1/models/actualyze%2Fmodel%3Alatest",
    );
    expect(detailUrls.some((url) => url.includes(foreignId))).toBe(false);
    expect(getDiscoveryStore()[0]).toMatchObject({
      probeType: "auto",
      detectedServer: "actualyze",
    });
  });

  it("should retain Actualyze detection when every Actualyze detail is invalid", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/v1/models")) {
        return {
          ok: true,
          json: async () => ({
            data: [{ id: "spoofed", owned_by: "atlas" }],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          id: "different-model",
          object: "model",
          created: 1,
          owned_by: "atlas",
          capabilities: {},
        }),
      };
    });
    const config: Record<string, unknown> = {
      provider: {
        actualyze: {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: "https://actualyze.test/v1", probe: "auto" },
        },
      },
    };

    await discoverModels(config);

    const providers = config.provider as Record<
      string,
      Record<string, unknown>
    >;
    const models = providers.actualyze.models as Record<
      string,
      Record<string, unknown>
    >;
    expect(models.spoofed.limit).toBeUndefined();
    expect(getDiscoveryStore()[0].detectedServer).toBe("actualyze");
  });

  it("should explicitly probe ownerless and foreign Actualyze entries without detectedServer", async () => {
    const ownerlessId = "ownerless/model";
    const foreignId = "foreign-model";
    const detailUrls = [
      "https://actualyze.test/openai/v1/models/ownerless%2Fmodel",
      "https://actualyze.test/openai/v1/models/foreign-model",
    ];
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/v1/models")) {
        return {
          ok: true,
          json: async () => ({
            data: [{ id: ownerlessId }, { id: foreignId, owned_by: "vllm" }],
          }),
        };
      }
      if (detailUrls.includes(url)) {
        const id = decodeURIComponent(url.split("/").at(-1) ?? "");
        return {
          ok: true,
          json: async () => ({
            id,
            object: "model",
            created: 1,
            owned_by: "atlas",
            context_window: 4096,
            max_output_tokens: 1024,
            capabilities: {
              vision: false,
              tool_use: true,
              thinking: false,
              thinking_adaptive: false,
            },
          }),
        };
      }
      return { ok: false, status: 404 };
    });
    const config: Record<string, unknown> = {
      provider: {
        actualyze: {
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: "https://actualyze.test/openai/v1",
            probe: "actualyze",
          },
        },
      },
    };

    await discoverModels(config);

    for (const detailUrl of detailUrls) {
      expect(mockFetch).toHaveBeenCalledWith(detailUrl, expect.any(Object));
    }
    const providers = config.provider as Record<
      string,
      Record<string, unknown>
    >;
    const models = providers.actualyze.models as Record<
      string,
      Record<string, unknown>
    >;
    for (const id of [ownerlessId, foreignId]) {
      expect(models[id]).toMatchObject({
        limit: { context: 4096, output: 1024 },
        tool_call: true,
      });
    }
    expect(getDiscoveryStore()[0]).toMatchObject({ probeType: "actualyze" });
    expect(getDiscoveryStore()[0].detectedServer).toBeUndefined();
  });

  it("should keep authoritative Actualyze false capabilities ahead of models.dev", async () => {
    const id = "all-capabilities-disabled";
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/v1/models")) {
        return {
          ok: true,
          json: async () => ({
            object: "list",
            data: [
              {
                id,
                object: "model",
                created: 1_700_000_000,
                owned_by: "atlas",
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          id,
          object: "model",
          created: 1_700_000_000,
          owned_by: "atlas",
          context_window: null,
          max_output_tokens: null,
          capabilities: {
            vision: false,
            tool_use: false,
            thinking: false,
            thinking_adaptive: false,
          },
        }),
      };
    });

    const config: Record<string, unknown> = {
      provider: {
        actualyze: {
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: "https://actualyze.test/openai/v1",
            probe: "auto",
          },
        },
      },
    };
    const modelsDevIndex = [
      {
        id,
        normalized: id,
        meta: {
          toolCall: true,
          reasoning: true,
          attachment: true,
          temperature: true,
          modalities: { input: ["text", "image"], output: ["text"] },
        },
      },
    ];

    await discoverModels(config, modelsDevIndex);

    const providers = config.provider as Record<
      string,
      Record<string, unknown>
    >;
    const models = providers.actualyze.models as Record<
      string,
      Record<string, unknown>
    >;
    expect(models[id]).toMatchObject({
      modalities: { input: ["text"], output: ["text"] },
    });
    expect(models[id].tool_call).toBeUndefined();
    expect(models[id].reasoning).toBeUndefined();
    expect(models[id].attachment).toBeUndefined();
    expect(
      Object.keys(models[id]).some((key) => key.startsWith("_probe")),
    ).toBe(false);
  });

  it("should allow models.dev fallback for unknown Actualyze capability values", async () => {
    const id = "unknown-capabilities";
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/v1/models")) {
        return {
          ok: true,
          json: async () => ({
            object: "list",
            data: [
              {
                id,
                object: "model",
                created: 1_700_000_000,
                owned_by: "atlas",
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          id,
          object: "model",
          created: 1_700_000_000,
          owned_by: "atlas",
          context_window: null,
          max_output_tokens: null,
          capabilities: {
            vision: "unknown",
            tool_use: null,
            thinking: false,
          },
        }),
      };
    });

    const config: Record<string, unknown> = {
      provider: {
        actualyze: {
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: "https://actualyze.test/openai/v1",
            probe: "auto",
          },
        },
      },
    };
    const modelsDevIndex = [
      {
        id,
        normalized: id,
        meta: {
          toolCall: true,
          reasoning: true,
          attachment: true,
          temperature: true,
        },
      },
    ];

    await discoverModels(config, modelsDevIndex);

    const providers = config.provider as Record<
      string,
      Record<string, unknown>
    >;
    const models = providers.actualyze.models as Record<
      string,
      Record<string, unknown>
    >;
    expect(models[id]).toMatchObject({
      tool_call: true,
      reasoning: true,
      attachment: true,
      modalities: { input: ["text", "image"], output: ["text"] },
    });
  });

  it("should map adaptive-only Actualyze reasoning without enabling false capabilities", async () => {
    const id = "adaptive-model";
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/v1/models")) {
        return {
          ok: true,
          json: async () => ({
            object: "list",
            data: [
              {
                id,
                object: "model",
                created: 1_700_000_000,
                owned_by: "atlas",
              },
            ],
          }),
        };
      }
      if (url.endsWith("/v1/models/adaptive-model")) {
        return {
          ok: true,
          json: async () => ({
            id,
            object: "model",
            created: 1_700_000_000,
            owned_by: "atlas",
            context_window: null,
            max_output_tokens: null,
            capabilities: {
              vision: false,
              tool_use: false,
              thinking: false,
              thinking_adaptive: true,
            },
          }),
        };
      }
      return { ok: false, status: 404 };
    });

    const config: Record<string, unknown> = {
      provider: {
        actualyze: {
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: "https://actualyze.test/openai/v1",
            probe: "auto",
          },
        },
      },
    };

    await discoverModels(config);

    const providers = config.provider as Record<
      string,
      Record<string, unknown>
    >;
    const models = providers.actualyze.models as Record<
      string,
      Record<string, unknown>
    >;
    expect({
      modalities: models[id].modalities,
      attachment: models[id].attachment,
      tool_call: models[id].tool_call,
      reasoning: models[id].reasoning,
      limit: models[id].limit,
    }).toEqual({
      modalities: { input: ["text"], output: ["text"] },
      attachment: undefined,
      tool_call: undefined,
      reasoning: true,
      limit: undefined,
    });
  });

  it("should skip probing when auto-detection returns undefined", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/v1/models")) {
        return {
          ok: true,
          json: async () => ({
            object: "list",
            data: [
              {
                id: "some-model",
                object: "model",
                created: 1700000000,
                owned_by: "unknown-provider",
              },
            ],
          }),
        };
      }
      // All fingerprint endpoints return 404
      return { ok: false, status: 404 };
    });

    const config: Record<string, unknown> = {
      provider: {
        "mystery-provider": {
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: "http://localhost:8000/v1",
            probe: "auto",
          },
        },
      },
    };

    await discoverModels(config);

    const providers = config.provider as Record<
      string,
      Record<string, unknown>
    >;
    const models = providers["mystery-provider"].models as Record<
      string,
      Record<string, unknown>
    >;
    // Model discovered but no probe enrichment (no limit set)
    expect(models["some-model"]).toBeDefined();
    expect(models["some-model"].limit).toBeUndefined();
  });

  it("should include detectedServer in discovery snapshot", async () => {
    setupFetchRouter({
      "/v1/models": {
        ok: true,
        body: {
          object: "list",
          data: [
            {
              id: "meta-llama/Llama-3-8B",
              object: "model",
              created: 1700000000,
              owned_by: "vllm",
              max_model_len: 8192,
            },
          ],
        },
      },
    });

    const config: Record<string, unknown> = {
      provider: {
        "auto-vllm": {
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: "http://localhost:8000/v1",
            probe: "auto",
          },
        },
      },
    };

    await discoverModels(config);

    const store = getDiscoveryStore();
    expect(store).toHaveLength(1);
    expect(store[0].detectedServer).toBe("vllm");
  });

  it("should still work with explicit probe names", async () => {
    setupFetchRouter({
      "/v1/models/status": {
        ok: true,
        body: {
          models: [
            {
              id: "qwen3-30b-a3b",
              loaded: true,
              model_type: "llm",
              max_context_window: 131072,
              max_tokens: 32768,
            },
          ],
        },
      },
      "/v1/models": {
        ok: true,
        body: {
          object: "list",
          data: [
            {
              id: "qwen3-30b-a3b",
              object: "model",
              created: 1700000000,
              owned_by: "local",
            },
          ],
        },
      },
    });

    const config: Record<string, unknown> = {
      provider: {
        "explicit-omlx": {
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: "http://localhost:8000/v1",
            probe: "omlx",
          },
        },
      },
    };

    await discoverModels(config);

    const providers = config.provider as Record<
      string,
      Record<string, unknown>
    >;
    const models = providers["explicit-omlx"].models as Record<
      string,
      Record<string, unknown>
    >;
    const model = models["qwen3-30b-a3b"];
    expect(model).toBeDefined();
    expect(model.limit).toEqual({ context: 131072, output: 32768 });
  });

  it("should abort discovery when signal is already aborted", async () => {
    setupFetchRouter({
      "/v1/models": {
        ok: true,
        body: {
          object: "list",
          data: [
            {
              id: "some-model",
              object: "model",
              created: 1700000000,
              owned_by: "local",
            },
          ],
        },
      },
    });

    const controller = new AbortController();
    controller.abort();

    const config: Record<string, unknown> = {
      provider: {
        "my-provider": {
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: "http://localhost:8000/v1",
          },
        },
      },
    };

    await discoverModels(config, undefined, controller.signal);

    // No fetch calls should have been made — abort checked before any work
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not mutate provider config when the signal aborts mid-flight", async () => {
    // Simulate the config-hook budget expiring while /v1/models is in flight:
    // the fetch resolves normally, but the signal is already aborted by the
    // time discovery would merge results. The config must stay untouched.
    const controller = new AbortController();
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/v1/models")) {
        controller.abort(); // budget expired during the request
        return {
          ok: true,
          json: async () => ({
            object: "list",
            data: [
              {
                id: "late-model",
                object: "model",
                created: 1700000000,
                owned_by: "local",
              },
            ],
          }),
        };
      }
      return { ok: false, status: 404 };
    });

    const config: Record<string, unknown> = {
      provider: {
        "my-provider": {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: "http://localhost:8000/v1" },
        },
      },
    };

    await discoverModels(config, undefined, controller.signal);

    // Discovered models must NOT be merged post-abort — the hook already
    // returned its fallback and opencode may be reading the config.
    const provider = (
      config.provider as Record<string, Record<string, unknown>>
    )["my-provider"];
    expect(provider.models).toBeUndefined();
  });

  it("does not clear the discovery store when already aborted", async () => {
    // First, a normal run populates the store.
    setupFetchRouter({
      "/v1/models": {
        ok: true,
        body: {
          object: "list",
          data: [
            {
              id: "some-model",
              object: "model",
              created: 1700000000,
              owned_by: "local",
            },
          ],
        },
      },
    });
    const config: Record<string, unknown> = {
      provider: {
        "my-provider": {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: "http://localhost:8000/v1" },
        },
      },
    };
    await discoverModels(config);
    expect(getDiscoveryStore().length).toBeGreaterThan(0);
    const populated = getDiscoveryStore();

    // A later invocation with an already-aborted signal (budget expired while
    // the models.dev index loaded) must bail out before resetting the store.
    const controller = new AbortController();
    controller.abort();
    await discoverModels(config, undefined, controller.signal);

    // Store untouched — not cleared to [].
    expect(getDiscoveryStore()).toBe(populated);
    expect(getDiscoveryStore().length).toBeGreaterThan(0);
  });

  it("should continue discovery when one provider throws", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      // Provider A: model list succeeds, but fingerprint probe endpoint throws
      if (url.includes("localhost:8001") && url.includes("/v1/models")) {
        return {
          ok: true,
          json: async () => ({
            object: "list",
            data: [
              {
                id: "model-a",
                object: "model",
                created: 1700000000,
                owned_by: "unknown-corp",
              },
            ],
          }),
        };
      }
      // Provider A: any other endpoint throws (simulates network error during probe)
      if (url.includes("localhost:8001")) {
        throw new TypeError("ECONNREFUSED");
      }

      // Provider B: everything works
      if (url.includes("localhost:8002") && url.includes("/v1/models")) {
        return {
          ok: true,
          json: async () => ({
            object: "list",
            data: [
              {
                id: "model-b",
                object: "model",
                created: 1700000000,
                owned_by: "local",
              },
            ],
          }),
        };
      }

      return { ok: false, status: 404 };
    });

    const config: Record<string, unknown> = {
      provider: {
        "provider-a": {
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: "http://localhost:8001/v1",
            probe: "auto",
          },
        },
        "provider-b": {
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: "http://localhost:8002/v1",
          },
        },
      },
    };

    await discoverModels(config);

    const providers = config.provider as Record<
      string,
      Record<string, unknown>
    >;

    // Provider B's model should still be discovered
    const modelsB = providers["provider-b"].models as Record<string, unknown>;
    expect(modelsB["model-b"]).toBeDefined();
  });

  it("should show auto-detected server in formatModelsTable", () => {
    const snapshots: DiscoverySnapshot[] = [
      {
        provider: "my-vllm",
        probeType: "auto",
        baseURL: "http://localhost:8000",
        models: {
          "meta-llama/Llama-3-8B": {
            id: "meta-llama/Llama-3-8B",
            name: "Llama 3 8B",
            limit: { context: 8192, output: 0 },
          },
        },
        skipped: [],
        detectedServer: "vllm",
      },
    ];

    const output = formatModelsTable(snapshots);
    expect(output).toContain("auto \u2192 vllm");
  });
});
