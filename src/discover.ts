import type { ProbeModelMeta, OpenAIModelEntry } from "./probes/types";
import { resolveProbe } from "./probes/index";
import type { ProbeContext, DetectedServer } from "./probes/index";
import {
  extractModelOwner,
  formatModelName,
  formatNumber,
  formatBytes,
} from "./format";
import { findMatch, type ModelsDevMeta } from "./models-dev";
import {
  buildHeaders,
  isFiniteNumber,
  probeFetch,
  readJson,
} from "./probes/util";

/** Snapshot of what was discovered for a single provider. */
export interface DiscoverySnapshot {
  provider: string;
  probeType: string | undefined;
  baseURL: string;
  models: Record<string, Record<string, unknown>>;
  /** Model IDs found on the server but already configured in opencode.json. */
  skipped: string[];
  detectedServer?: DetectedServer;
}

/** Shape of the OpenAI /v1/models response body. */
interface OpenAIModelsResponse {
  data?: unknown;
}

/** Module-level store of discovery results, reset on each run. */
let discoveryStore: DiscoverySnapshot[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOpenAIModelEntry(value: unknown): value is OpenAIModelEntry {
  return isRecord(value) && typeof value.id === "string" && value.id.length > 0;
}

/** Get the current discovery store (read-only). */
export function getDiscoveryStore(): readonly DiscoverySnapshot[] {
  return discoveryStore;
}

/**
 * Strip trailing slash and trailing /v1 from a URL.
 * E.g. "http://localhost:8000/v1/" → "http://localhost:8000"
 */
function normalizeBaseURL(url: string): string {
  let normalized = url.replace(/\/+$/, "");
  if (normalized.endsWith("/v1")) {
    normalized = normalized.slice(0, -3);
  }
  return normalized;
}

/**
 * Fetch the list of models from a provider's /v1/models endpoint.
 * Also serves as a health check — returns empty array on any failure.
 */
async function fetchModels(
  baseURL: string,
  apiKey?: string,
  signal?: AbortSignal,
): Promise<OpenAIModelEntry[]> {
  try {
    const headers = buildHeaders(apiKey);
    const res = await probeFetch(`${baseURL}/v1/models`, {
      headers,
      signal,
      timeoutMs: 3000,
    });
    if (!res) return [];
    if (!res.ok) return [];
    // Bounded body read: some gateways send headers fast then stall the body.
    const data = await readJson<OpenAIModelsResponse>(res, 3000);
    if (!data || !Array.isArray(data.data)) return [];
    return data.data.filter(isOpenAIModelEntry);
  } catch {
    return [];
  }
}

/**
 * Check if a provider config is eligible for model discovery.
 * Returns true if:
 * - npm is "@ai-sdk/openai-compatible" (standard OpenAI-compatible SDK), OR
 * - options.baseURL contains "/v1" (likely OpenAI-compatible even with other npm packages)
 */
function canDiscover(provider: Record<string, unknown>): boolean {
  if (provider.npm === "@ai-sdk/openai-compatible") return true;

  const options = provider.options as Record<string, unknown> | undefined;
  if (options?.baseURL && typeof options.baseURL === "string") {
    return options.baseURL.includes("/v1");
  }

  return false;
}

/** Known LLM model name patterns for keyword-based categorization. */
const LLM_KEYWORDS = [
  "llama",
  "qwen",
  "gemma",
  "mistral",
  "phi",
  "gpt",
  "claude",
  "deepseek",
  "codestral",
  "starcoder",
  "coder",
  "chat",
  "instruct",
  "wizard",
  "falcon",
  "internlm",
  "glm",
  "command",
  "solar",
  "hermes",
  "vicuna",
  "orca",
  "zephyr",
  "neural",
  "tinyllama",
];

/**
 * Short keywords that need word-boundary matching to avoid false positives
 * (e.g., "yi" inside "binaryai"). Matched with regex \bKEYWORD\b.
 */
const LLM_KEYWORDS_BOUNDARY = [/\byi\b/i];

/**
 * Categorize a model by its ID using keyword matching.
 * Returns "embedding", "chat", or "unknown".
 */
function categorizeModel(id: string): "embedding" | "chat" | "unknown" {
  const lower = id.toLowerCase();
  if (lower.includes("embedding") || lower.includes("embed")) {
    return "embedding";
  }
  for (const keyword of LLM_KEYWORDS) {
    if (lower.includes(keyword)) return "chat";
  }
  for (const pattern of LLM_KEYWORDS_BOUNDARY) {
    if (pattern.test(id)) return "chat";
  }
  return "unknown";
}

/**
 * Enrich a model config object with metadata from a probe.
 */
function applyProbeMeta(
  model: Record<string, unknown>,
  meta: ProbeModelMeta,
): void {
  // Limits — only set if not already present. Omit unknown fields
  // rather than defaulting to 0 (which would mean "no output allowed").
  if (
    !model.limit &&
    (isFiniteNumber(meta.context) || isFiniteNumber(meta.maxTokens))
  ) {
    const limit: Record<string, number> = {};
    if (isFiniteNumber(meta.context)) limit.context = meta.context;
    if (isFiniteNumber(meta.maxTokens)) limit.output = meta.maxTokens;
    model.limit = limit;
  }

  // Modalities — probe is more accurate than keyword guess, always override for discovered models
  if (meta.vision === false) model._probeNoVision = true;
  if (meta.vision || meta.modelType === "vlm") {
    model.modalities = { input: ["text", "image"], output: ["text"] };
    model.attachment = true;
  } else if (meta.modelType === "llm") {
    model.modalities = { input: ["text"], output: ["text"] };
  } else if (meta.modelType === "embedding") {
    // Probe confirms this is an embedding model — clear any chat modalities
    // that keyword categorization may have set (output:["embedding"] is invalid
    // in opencode, so we remove modalities entirely)
    delete model.modalities;
    delete model.attachment;
    // Mark as probe-confirmed embedding so fallback enrichment skips modalities
    model._probeEmbedding = true;
  }

  // Capability flags — only set if not already present on model
  if (meta.toolCall === true && model.tool_call === undefined)
    model.tool_call = true;
  else if (meta.toolCall === false) model._probeNoToolCall = true;
  if (meta.reasoning === true && model.reasoning === undefined)
    model.reasoning = true;
  else if (meta.reasoning === false) model._probeNoReasoning = true;
  // temperature: all probed models support temperature — set as default,
  // allow probe override if it explicitly provides a different value
  if (model.temperature === undefined) model.temperature = true;
  if (meta.temperature !== undefined) model.temperature = meta.temperature;
  if (meta.family && !model.family) model.family = meta.family;

  // Probe-specific metadata (for display in /actualyze)
  if (meta.parameterSize) model.parameterSize = meta.parameterSize;
  if (meta.quantization) model.quantization = meta.quantization;
  if (isFiniteNumber(meta.sizeBytes)) model.sizeBytes = meta.sizeBytes;
}

/**
 * Apply models.dev metadata as a fallback enrichment source.
 * Only sets fields that are not already present on the model.
 * Respects probe authority sentinels for unsupported capabilities and
 * probe-confirmed embedding models.
 */
function applyModelsDevMeta(
  model: Record<string, unknown>,
  meta: ModelsDevMeta,
): void {
  const isProbeEmbedding = model._probeEmbedding === true;
  const isToolCallDenied = model._probeNoToolCall === true;
  const isReasoningDenied = model._probeNoReasoning === true;
  const isVisionDenied = model._probeNoVision === true;

  if (meta.toolCall && !isToolCallDenied && model.tool_call === undefined)
    model.tool_call = true;
  if (meta.reasoning && !isReasoningDenied && model.reasoning === undefined)
    model.reasoning = true;
  if (!isProbeEmbedding && !isVisionDenied && meta.attachment) {
    model.attachment = true;
    model.modalities = { input: ["text", "image"], output: ["text"] };
  }
  if (meta.temperature && model.temperature === undefined)
    model.temperature = true;
  if (meta.family && !model.family) model.family = meta.family;
  if (
    !isProbeEmbedding &&
    !isVisionDenied &&
    meta.modalities &&
    !model.modalities
  )
    model.modalities = meta.modalities;
}

/** Flattened models.dev index for matching. */
interface ModelsDevIndex {
  readonly id: string;
  readonly normalized: string;
  readonly family?: string;
  readonly meta: ModelsDevMeta;
}

/**
 * Discover models from all eligible providers in the config and enrich
 * with probe metadata and models.dev fallback. Mutates config.provider.*.models in place.
 */
export async function discoverModels(
  config: Record<string, unknown>,
  modelsDevIndex?: readonly ModelsDevIndex[],
  signal?: AbortSignal,
): Promise<void> {
  try {
    // If the config-hook budget already expired (e.g. while the models.dev
    // index was still loading), do nothing: withTimeout has returned its
    // fallback and clearing the store now would race a later read.
    if (signal?.aborted) return;

    // Reset store
    discoveryStore = [];

    const providers = config.provider as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (!providers) return;

    for (const [providerName, providerConfig] of Object.entries(providers)) {
      if (signal?.aborted) break;
      try {
        if (!canDiscover(providerConfig)) continue;

        const options = providerConfig.options as
          | Record<string, unknown>
          | undefined;
        const rawBaseURL = options?.baseURL;
        if (!rawBaseURL || typeof rawBaseURL !== "string") continue;

        const baseURL = normalizeBaseURL(rawBaseURL);
        const apiKey = options?.apiKey as string | undefined;

        // Fetch model list (also serves as health check)
        const openaiModels = await fetchModels(baseURL, apiKey, signal);
        if (openaiModels.length === 0) continue;

        const existingModels = (providerConfig.models ?? {}) as Record<
          string,
          unknown
        >;
        const discoveredModels = Object.create(null) as Record<
          string,
          Record<string, unknown>
        >;
        const skippedIds: string[] = [];

        for (const model of openaiModels) {
          // Track models already configured but don't overwrite them
          if (Object.hasOwn(existingModels, model.id)) {
            skippedIds.push(model.id);
            continue;
          }

          const category = categorizeModel(model.id);
          const entry: Record<string, unknown> = {
            id: model.id,
            name: formatModelName(model.id),
          };

          const owner = extractModelOwner(model.id);
          if (owner) {
            entry.organizationOwner = owner;
          }

          if (category === "embedding") {
            // Don't set modalities for embedding models —
            // output:["embedding"] is not valid in opencode's schema
          } else if (category === "chat") {
            // Default to text-only; probe will upgrade to image if vision is confirmed
            entry.modalities = {
              input: ["text"],
              output: ["text"],
            };
          }

          discoveredModels[model.id] = entry;
        }

        const probeType = options?.probe as string | undefined;
        const probeSelection = probeType === "auto" ? "auto" : "explicit";
        const context: ProbeContext = {
          modelsResponse: openaiModels,
          probeSelection,
          signal,
        };
        // Resolve probe (supports explicit names, "auto", or undefined)
        const { probe, detectedServer } = await resolveProbe(
          probeType,
          baseURL,
          apiKey,
          context,
          signal,
        );

        if (probe) {
          try {
            const probeResult = await probe(baseURL, apiKey, context);
            for (const [modelId, meta] of Object.entries(probeResult.models)) {
              const discovered = discoveredModels[modelId];
              if (discovered) {
                applyProbeMeta(discovered, meta);
              }
            }
          } catch {
            // Probe failed — the model is still discovered, just less enriched.
            // Never write to stdout/stderr from a config-hook plugin.
          }
        }

        // Apply models.dev fallback for any remaining unenriched models
        if (modelsDevIndex && modelsDevIndex.length > 0) {
          for (const [modelId, model] of Object.entries(discoveredModels)) {
            const match = findMatch(modelId, modelsDevIndex);
            if (match) {
              applyModelsDevMeta(model, match);
            }
          }
        }

        // If the config-hook budget expired while we were awaiting fetch/probe
        // above, the hook has already returned its fallback. Do not mutate the
        // (now-consumed) config or the discovery store — that would be a
        // post-timeout race with opencode reading the config.
        if (signal?.aborted) break;

        // Clean up internal sentinel before merging into opencode config
        for (const model of Object.values(discoveredModels)) {
          delete model._probeEmbedding;
          delete model._probeNoToolCall;
          delete model._probeNoReasoning;
          delete model._probeNoVision;
        }

        // Merge discovered models into provider config
        if (Object.keys(discoveredModels).length > 0) {
          providerConfig.models = { ...existingModels, ...discoveredModels };
        }

        // Record discovery results (including skipped models for /actualyze)
        if (Object.keys(discoveredModels).length > 0 || skippedIds.length > 0) {
          discoveryStore.push({
            provider: providerName,
            probeType,
            baseURL,
            models: discoveredModels,
            skipped: skippedIds,
            detectedServer,
          });
        }
      } catch {
        // Per-provider isolation: one failing provider never blocks the others.
      }
    }
  } catch {
    // Discovery is best-effort; failures must never break opencode startup.
  }
}

/**
 * Format discovery results as a human-readable table.
 * Pure function — no side effects. Operates on the server-side
 * `DiscoverySnapshot` shape produced by `discoverModels`.
 */
export function formatModelsTable(
  snapshots: readonly DiscoverySnapshot[],
): string {
  if (snapshots.length === 0) {
    return "Models Discovery\n\nNo models discovered. Providers may be offline or excluded by config.";
  }

  const sections: string[] = ["Models Discovery"];

  for (const snap of snapshots) {
    const discovered = Object.keys(snap.models).length;
    const total = discovered + snap.skipped.length;
    const probeLabel = snap.detectedServer
      ? `auto \u2192 ${snap.detectedServer}`
      : snap.probeType
        ? `probe: ${snap.probeType}`
        : "no probe";
    const countLabel =
      snap.skipped.length > 0
        ? `${total} model${total !== 1 ? "s" : ""} (${discovered} new)`
        : `${discovered} model${discovered !== 1 ? "s" : ""}`;
    const header = `\n${snap.provider} (${probeLabel}) — ${countLabel}`;
    const separator = "\u2500".repeat(50);

    sections.push(header);
    sections.push(separator);

    for (const [id, model] of Object.entries(snap.models)) {
      sections.push(`  ${id}`);

      const parts: string[] = [];

      // Context and output limits
      const limit = model.limit as
        | { context?: number; output?: number }
        | undefined;
      if (limit?.context) parts.push(`Context: ${formatNumber(limit.context)}`);
      if (limit?.output) parts.push(`Output: ${formatNumber(limit.output)}`);

      // Model type from modalities
      if (model.modalities) {
        const mod = model.modalities as {
          input?: string[];
          output?: string[];
        };
        if (mod.output?.includes("embedding")) {
          parts.push("Type: embedding");
        } else if (mod.input?.includes("image")) {
          parts.push("Type: vlm");
        } else {
          parts.push("Type: llm");
        }
      }

      // Capability flags
      const flags: string[] = [];
      if (model.attachment) flags.push("Vision");
      if (model.tool_call) flags.push("Tools");
      if (model.reasoning) flags.push("Reasoning");
      if (model.temperature) flags.push("Temp");
      if (flags.length > 0) parts.push(flags.join(", "));

      // Family and probe details (values are strings from probe metadata)
      if (model.family) parts.push(`Family: ${model.family as string}`);
      if (model.parameterSize)
        parts.push(`Params: ${model.parameterSize as string}`);
      if (model.quantization)
        parts.push(`Quant: ${model.quantization as string}`);
      if (model.sizeBytes)
        parts.push(`Size: ${formatBytes(model.sizeBytes as number)}`);

      if (parts.length > 0) {
        sections.push(`    ${parts.join(" | ")}`);
      }
    }

    if (snap.skipped.length > 0) {
      sections.push(
        `\n  Already configured (${snap.skipped.length}): ${snap.skipped.join(", ")}`,
      );
    }
  }

  return sections.join("\n");
}
