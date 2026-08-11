import { afterEach, describe, expect, it, vi } from "vitest";
import { probeActualyze } from "../../src/probes/actualyze";
import type { OpenAIModelEntry } from "../../src/probes/types";

function listedModel(id: string): OpenAIModelEntry {
  return {
    id,
    object: "model",
    created: 1_700_000_000,
    owned_by: "atlas",
  };
}

function listedModelWithOwner(
  id: string,
  ownedBy: string | undefined,
): OpenAIModelEntry {
  return { ...listedModel(id), owned_by: ownedBy };
}

function detail(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    object: "model",
    created: 1_700_000_000,
    owned_by: "atlas",
    context_window: 131_072,
    max_output_tokens: 16_384,
    capabilities: {
      vision: true,
      video: false,
      tool_use: true,
      thinking: true,
      thinking_adaptive: false,
      structured_output: true,
      streaming: true,
      caching: true,
      audio: false,
      document: true,
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("probeActualyze", () => {
  it("auto mode requests each unique Actualyze-owned safe ID and no others", async () => {
    const encodedId = "actualyze/model:latest";
    mockFetch.mockImplementation(async (url: string) => {
      const id = decodeURIComponent(url.split("/").at(-1) ?? "");
      return { ok: true, json: async () => detail(id) };
    });

    const result = await probeActualyze(
      "https://actualyze.test/openai",
      undefined,
      {
        probeSelection: "auto",
        modelsResponse: [
          listedModel(encodedId),
          listedModel(encodedId),
          listedModelWithOwner("foreign", "vllm"),
          listedModelWithOwner("ownerless", undefined),
          listedModelWithOwner("Atlas-case", "Atlas"),
          listedModel("."),
        ],
      },
    );

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      "https://actualyze.test/openai/v1/models/actualyze%2Fmodel%3Alatest",
      expect.any(Object),
    );
    expect(Object.keys(result.models)).toEqual([encodedId]);
  });

  it("auto mode returns empty before requests when no entry is Actualyze-owned", async () => {
    const result = await probeActualyze(
      "https://actualyze.test/openai",
      "secret",
      {
        probeSelection: "auto",
        modelsResponse: [
          listedModelWithOwner("foreign", "vllm"),
          listedModelWithOwner("ownerless", undefined),
          listedModelWithOwner("padded", "atlas "),
        ],
      },
    );

    expect(result).toEqual({ models: {} });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each(["explicit", undefined] as const)(
    "%s selection requests safe foreign and ownerless IDs",
    async (probeSelection) => {
      mockFetch.mockImplementation(async (url: string) => {
        const id = decodeURIComponent(url.split("/").at(-1) ?? "");
        return { ok: true, json: async () => detail(id) };
      });

      const result = await probeActualyze(
        "https://actualyze.test/openai",
        undefined,
        {
          probeSelection,
          modelsResponse: [
            listedModelWithOwner("foreign", "vllm"),
            listedModelWithOwner("ownerless", undefined),
          ],
        },
      );

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(Object.keys(result.models).sort()).toEqual([
        "foreign",
        "ownerless",
      ]);
    },
  );

  it("isolates failed and rate-limited Actualyze details from a successful sibling", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      const id = decodeURIComponent(url.split("/").at(-1) ?? "");
      if (id === "failed") throw new Error("ECONNRESET");
      if (id === "limited") return { ok: false, status: 429 };
      return { ok: true, json: async () => detail(id) };
    });

    const result = await probeActualyze(
      "https://actualyze.test/openai",
      undefined,
      {
        probeSelection: "auto",
        modelsResponse: [
          listedModel("good"),
          listedModel("failed"),
          listedModel("limited"),
        ],
      },
    );

    expect(result.models).toEqual({
      good: expect.objectContaining({ context: 131_072 }),
    });
  });

  it("maps full Actualyze metadata and sends auth to the encoded detail URL", async () => {
    const id = "org/model:latest";
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => detail(id),
    });

    const result = await probeActualyze(
      "https://actualyze.test/openai",
      "secret",
      {
        modelsResponse: [listedModel(id)],
      },
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "https://actualyze.test/openai/v1/models/org%2Fmodel%3Alatest",
      expect.objectContaining({
        headers: { Authorization: "Bearer secret" },
      }),
    );
    expect(result.models[id]).toEqual({
      context: 131_072,
      maxTokens: 16_384,
      modelType: "vlm",
      vision: true,
      toolCall: true,
      reasoning: true,
    });
  });

  it("omits invalid limits and preserves authoritative capability booleans", async () => {
    const ids = [
      "null",
      "nan",
      "wrong-type",
      "zero",
      "negative",
      "fractional",
      "unsafe",
    ];
    const responses: Record<string, Record<string, unknown>> = {
      null: detail("null", {
        context_window: null,
        max_output_tokens: null,
        capabilities: {
          vision: false,
          tool_use: false,
          thinking: false,
          thinking_adaptive: false,
        },
      }),
      nan: detail("nan", {
        context_window: Number.NaN,
        max_output_tokens: Number.POSITIVE_INFINITY,
        capabilities: {
          vision: false,
          tool_use: false,
          thinking: false,
          thinking_adaptive: true,
        },
      }),
      "wrong-type": detail("wrong-type", {
        context_window: "131072",
        max_output_tokens: {},
        capabilities: {
          vision: "true",
          tool_use: 1,
          thinking: null,
          thinking_adaptive: false,
        },
      }),
      zero: detail("zero", { context_window: 0, max_output_tokens: 0 }),
      negative: detail("negative", {
        context_window: -1,
        max_output_tokens: -2,
      }),
      fractional: detail("fractional", {
        context_window: 1.5,
        max_output_tokens: 2.5,
      }),
      unsafe: detail("unsafe", {
        context_window: Number.MAX_SAFE_INTEGER + 1,
        max_output_tokens: Number.MAX_SAFE_INTEGER + 2,
      }),
    };
    mockFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        responses[decodeURIComponent(url.split("/").at(-1) ?? "")],
    }));

    const result = await probeActualyze(
      "https://actualyze.test/openai",
      undefined,
      {
        modelsResponse: ids.map(listedModel),
      },
    );

    expect(result.models.null).toEqual({
      modelType: "llm",
      vision: false,
      toolCall: false,
      reasoning: false,
    });
    expect(result.models.nan).toEqual({
      modelType: "llm",
      vision: false,
      toolCall: false,
      reasoning: true,
    });
    expect(result.models["wrong-type"]).toEqual({});
    for (const id of ["zero", "negative", "fractional", "unsafe"]) {
      expect(result.models[id].context).toBeUndefined();
      expect(result.models[id].maxTokens).toBeUndefined();
    }
  });

  it("rejects mismatched identities and malformed capability containers without dropping a valid sibling", async () => {
    const ids = [
      "good",
      "wrong-id",
      "wrong-owner",
      "wrong-object",
      "missing-capabilities",
      "null-capabilities",
      "array-capabilities",
    ];
    const responses: Record<string, Record<string, unknown>> = {
      good: detail("good"),
      "wrong-id": detail("different-id"),
      "wrong-owner": detail("wrong-owner", { owned_by: "someone-else" }),
      "wrong-object": detail("wrong-object", { object: "model.detail" }),
      "missing-capabilities": detail("missing-capabilities", {
        capabilities: undefined,
      }),
      "null-capabilities": detail("null-capabilities", {
        capabilities: null,
      }),
      "array-capabilities": detail("array-capabilities", {
        capabilities: [],
      }),
    };
    mockFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        responses[decodeURIComponent(url.split("/").at(-1) ?? "")],
    }));

    const result = await probeActualyze(
      "https://actualyze.test/openai",
      undefined,
      {
        modelsResponse: ids.map(listedModel),
      },
    );

    expect(result.models).toEqual({
      good: {
        context: 131_072,
        maxTokens: 16_384,
        modelType: "vlm",
        vision: true,
        toolCall: true,
        reasoning: true,
      },
    });
  });

  it("omits authorization when no API key is configured", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => detail("model"),
    });

    await probeActualyze("https://actualyze.test/openai", undefined, {
      modelsResponse: [listedModel("model")],
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://actualyze.test/openai/v1/models/model",
      expect.objectContaining({ headers: {} }),
    );
  });

  it("collapses duplicate listed model IDs into one metadata entry", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => detail("duplicate"),
    });

    const result = await probeActualyze(
      "https://actualyze.test/openai",
      undefined,
      {
        modelsResponse: [listedModel("duplicate"), listedModel("duplicate")],
      },
    );

    expect(Object.keys(result.models)).toEqual(["duplicate"]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects dot-segment model IDs before constructing URLs", async () => {
    const result = await probeActualyze(
      "https://actualyze.test/openai",
      undefined,
      {
        modelsResponse: [listedModel("."), listedModel("..")],
      },
    );

    expect(result).toEqual({ models: {} });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("isolates a malformed Unicode ID from a valid sibling", async () => {
    const validId = "valid-model";
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => detail(validId),
    });

    const result = await probeActualyze(
      "https://actualyze.test/openai",
      undefined,
      {
        modelsResponse: [listedModel("\ud800"), listedModel(validId)],
      },
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://actualyze.test/openai/v1/models/valid-model",
      expect.any(Object),
    );
    expect(Object.keys(result.models)).toEqual([validId]);
    expect(result.models[validId].context).toBe(131_072);
  });

  it("bounds concurrent detail requests", async () => {
    const ids = Array.from({ length: 20 }, (_, index) => `model-${index}`);
    let active = 0;
    let maxActive = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockFetch.mockImplementation(async (url: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate;
      active -= 1;
      const id = decodeURIComponent(url.split("/").at(-1) ?? "");
      return { ok: true, json: async () => detail(id) };
    });

    const resultPromise = probeActualyze(
      "https://actualyze.test/openai",
      undefined,
      {
        probeSelection: "auto",
        modelsResponse: ids.map(listedModel),
      },
    );
    await vi.waitFor(() => expect(active).toBe(8));
    release?.();
    const result = await resultPromise;

    expect(maxActive).toBe(8);
    expect(Object.keys(result.models)).toHaveLength(20);
  });

  it("aborts active requests and does not schedule or return partial metadata", async () => {
    const controller = new AbortController();
    const ids = Array.from({ length: 20 }, (_, index) => `model-${index}`);
    let started = 0;
    let aborted = 0;
    mockFetch.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          started += 1;
          init?.signal?.addEventListener(
            "abort",
            () => {
              aborted += 1;
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
        }),
    );

    const resultPromise = probeActualyze(
      "https://actualyze.test/openai",
      undefined,
      {
        probeSelection: "auto",
        modelsResponse: ids.map(listedModel),
        signal: controller.signal,
      },
    );
    await vi.waitFor(() => expect(started).toBe(8));
    controller.abort();

    await expect(resultPromise).resolves.toEqual({ models: {} });
    expect(started).toBe(8);
    expect(aborted).toBe(8);
  });

  it("supports reserved property names as literal model IDs", async () => {
    const ids = ["constructor", "__proto__"];
    mockFetch.mockImplementation(async (url: string) => {
      const id = decodeURIComponent(url.split("/").at(-1) ?? "");
      return { ok: true, json: async () => detail(id) };
    });

    const result = await probeActualyze(
      "https://actualyze.test/openai",
      undefined,
      {
        modelsResponse: ids.map(listedModel),
      },
    );

    expect(Object.hasOwn(result.models, "constructor")).toBe(true);
    expect(Object.hasOwn(result.models, "__proto__")).toBe(true);
    expect(result.models["constructor"].context).toBe(131_072);
    expect(result.models["__proto__"].context).toBe(131_072);
  });

  it("treats adaptive-only thinking as reasoning while retaining an LLM model type", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () =>
        detail("adaptive", {
          capabilities: {
            vision: false,
            tool_use: false,
            thinking: false,
            thinking_adaptive: true,
          },
        }),
    });

    const result = await probeActualyze(
      "https://actualyze.test/openai",
      undefined,
      {
        modelsResponse: [listedModel("adaptive")],
      },
    );

    expect(result.models.adaptive).toEqual({
      modelType: "llm",
      vision: false,
      toolCall: false,
      reasoning: true,
      context: 131_072,
      maxTokens: 16_384,
    });
  });

  it("returns empty without making requests when model context is absent or empty", async () => {
    await expect(
      probeActualyze("https://actualyze.test/openai"),
    ).resolves.toEqual({
      models: {},
    });
    await expect(
      probeActualyze("https://actualyze.test/openai", undefined, {
        modelsResponse: [],
      }),
    ).resolves.toEqual({ models: {} });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("isolates non-OK, network, malformed, and hanging-body failures", async () => {
    vi.useFakeTimers();
    const ids = ["good", "non-ok", "network", "malformed", "hanging"];
    const cancel = vi.fn(async () => undefined);
    mockFetch.mockImplementation(async (url: string) => {
      const id = decodeURIComponent(url.split("/").at(-1) ?? "");
      if (id === "non-ok") {
        return { ok: false, status: 503, body: { cancel } };
      }
      if (id === "network") throw new Error("ECONNRESET");
      if (id === "malformed") {
        return {
          ok: true,
          json: async () => Promise.reject(new SyntaxError()),
        };
      }
      if (id === "hanging") {
        return {
          ok: true,
          json: () => new Promise<never>(() => {}),
          body: { cancel: async () => undefined },
        };
      }
      return { ok: true, json: async () => detail(id) };
    });

    const resultPromise = probeActualyze(
      "https://actualyze.test/openai",
      undefined,
      {
        modelsResponse: ids.map(listedModel),
      },
    );
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await resultPromise;

    expect(result.models).toEqual({
      good: {
        context: 131_072,
        maxTokens: 16_384,
        modelType: "vlm",
        vision: true,
        toolCall: true,
        reasoning: true,
      },
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("returns empty when every detail request fails", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const result = await probeActualyze(
      "https://actualyze.test/openai",
      undefined,
      {
        modelsResponse: [listedModel("a"), listedModel("b")],
      },
    );

    expect(result).toEqual({ models: {} });
  });
});
