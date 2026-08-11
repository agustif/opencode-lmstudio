import type { ProbeModelMeta, ProbeResult, ProviderProbe } from "./types";
import { buildHeaders, EMPTY_RESULT, probeFetch, readJson } from "./util";

interface ActualyzeCapabilities {
  vision?: unknown;
  tool_use?: unknown;
  thinking?: unknown;
  thinking_adaptive?: unknown;
}

interface ActualyzeModelDetail {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  context_window?: unknown;
  max_output_tokens?: unknown;
  capabilities: ActualyzeCapabilities;
}

const ACTUALYZE_DETAIL_CONCURRENCY = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isSafeModelId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value !== "." &&
    value !== ".."
  );
}

function cancelBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => {});
  } catch {
    // Best-effort cleanup for an unused response body.
  }
}

function isActualyzeDetail(
  value: unknown,
  expectedId: string,
): value is ActualyzeModelDetail {
  if (!isRecord(value) || !isRecord(value.capabilities)) return false;

  // "atlas" is the fixed gateway-identity string the Actualyze server
  // reports in owned_by — it is wire protocol, not branding.
  return (
    value.id === expectedId &&
    value.object === "model" &&
    typeof value.created === "number" &&
    Number.isFinite(value.created) &&
    value.owned_by === "atlas"
  );
}

function toProbeMeta(detail: ActualyzeModelDetail): ProbeModelMeta {
  const meta: ProbeModelMeta = {};

  if (isPositiveSafeInteger(detail.context_window)) {
    meta.context = detail.context_window;
  }
  if (isPositiveSafeInteger(detail.max_output_tokens)) {
    meta.maxTokens = detail.max_output_tokens;
  }

  if (typeof detail.capabilities.vision === "boolean") {
    meta.vision = detail.capabilities.vision;
  }
  if (meta.vision === true) {
    meta.modelType = "vlm";
  } else if (meta.vision === false) {
    meta.modelType = "llm";
  }
  if (typeof detail.capabilities.tool_use === "boolean") {
    meta.toolCall = detail.capabilities.tool_use;
  }
  if (
    detail.capabilities.thinking === true ||
    detail.capabilities.thinking_adaptive === true
  ) {
    meta.reasoning = true;
  } else if (
    detail.capabilities.thinking === false &&
    detail.capabilities.thinking_adaptive === false
  ) {
    meta.reasoning = false;
  }

  return meta;
}

/** Probe Actualyze model detail endpoints in parallel. */
export const probeActualyze: ProviderProbe = async (
  baseURL,
  apiKey,
  context,
): Promise<ProbeResult> => {
  try {
    const listedModels = context?.modelsResponse;
    if (!listedModels || listedModels.length === 0) return EMPTY_RESULT;

    const signal = context?.signal;
    if (signal?.aborted) return EMPTY_RESULT;

    const eligibleModels =
      context?.probeSelection === "auto"
        ? listedModels.filter((model) => model?.owned_by === "atlas")
        : listedModels;
    if (eligibleModels.length === 0) return EMPTY_RESULT;

    const modelIds = [
      ...new Set(
        eligibleModels.map((model) => model?.id).filter(isSafeModelId),
      ),
    ];
    if (modelIds.length === 0) return EMPTY_RESULT;

    const headers = buildHeaders(apiKey);
    const models = Object.create(null) as Record<string, ProbeModelMeta>;
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      while (!signal?.aborted) {
        const id = modelIds[nextIndex];
        nextIndex += 1;
        if (id === undefined) return;

        let encodedId: string;
        try {
          encodedId = encodeURIComponent(id);
        } catch {
          continue;
        }

        const response = await probeFetch(`${baseURL}/v1/models/${encodedId}`, {
          headers,
          signal,
        });
        if (!response) continue;
        if (!response.ok) {
          cancelBody(response);
          continue;
        }

        const detail = await readJson<unknown>(response, 2000);
        if (!signal?.aborted && isActualyzeDetail(detail, id)) {
          models[id] = toProbeMeta(detail);
        }
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(ACTUALYZE_DETAIL_CONCURRENCY, modelIds.length) },
        worker,
      ),
    );

    if (signal?.aborted) return EMPTY_RESULT;

    return Object.keys(models).length === 0 ? EMPTY_RESULT : { models };
  } catch {
    return EMPTY_RESULT;
  }
};
