/**
 * Minimal structural view of the opencode SDK `Provider` shape
 * (`@opencode-ai/sdk/v2`). Declared locally so the TUI data layer can be
 * unit-tested without importing the SDK and so the server build never
 * depends on the TUI types.
 */
export interface SdkModelView {
  id: string;
  name?: string;
  family?: string;
  /** Provider adapter info; `api.npm` is the AI SDK package powering the model. */
  api?: { npm?: string; url?: string };
  limit?: {
    context?: number;
    output?: number;
  };
  capabilities?: {
    temperature?: boolean;
    reasoning?: boolean;
    attachment?: boolean;
    toolcall?: boolean;
    input?: { image?: boolean };
    output?: { text?: boolean };
  };
  /** Extra fields the plugin may have injected (parameterSize, etc.). */
  [key: string]: unknown;
}

export interface SdkProviderView {
  id: string;
  name?: string;
  source?: string;
  options?: Record<string, unknown>;
  models?: Record<string, SdkModelView>;
}

/** A single model row prepared for display. */
export interface ModelRow {
  id: string;
  name: string;
  context?: number;
  output?: number;
  type?: "llm" | "vlm" | "embedding";
  flags: string[];
  family?: string;
  parameterSize?: string;
  quantization?: string;
  sizeBytes?: number;
}

/** A provider grouping prepared for display. */
export interface ProviderGroup {
  provider: string;
  baseURL?: string;
  models: ModelRow[];
}

const OPENAI_COMPATIBLE_NPM = "@ai-sdk/openai-compatible";

/**
 * Decide whether a provider is one Actualyze actually discovers.
 *
 * Mirrors the server's *effective* discovery predicate (`discover.ts`), which
 * is two-stage: `canDiscover` returns true when the provider uses the
 * `@ai-sdk/openai-compatible` adapter **or** its `options.baseURL` contains
 * `/v1`, and discovery then hard-requires a string `options.baseURL` before
 * probing. So a provider is discovered iff:
 *
 *   options.baseURL is a non-empty string
 *   AND (any model uses the openai-compatible adapter OR baseURL contains /v1)
 *
 * Requiring `options.baseURL` is also what excludes opencode's built-in cloud
 * providers (OpenCode Zen/Go, OpenAI, Anthropic, …) from the dialog: those
 * carry their endpoint on each `model.api.url` and have no `options.baseURL`,
 * even when (like Zen) they use the openai-compatible adapter. The npm signal
 * lives on `model.api.npm` in the SDK shape, not on the provider.
 */
function looksDiscoverable(provider: SdkProviderView): boolean {
  const baseURL = provider.options?.baseURL;
  if (typeof baseURL !== "string" || baseURL.length === 0) return false;
  if (baseURL.includes("/v1")) return true;

  const models = provider.models ?? {};
  for (const model of Object.values(models)) {
    if (model.api?.npm === OPENAI_COMPATIBLE_NPM) return true;
  }
  return false;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** Map a single SDK model into a display row. */
export function toModelRow(id: string, model: SdkModelView): ModelRow {
  const caps = model.capabilities;

  let type: ModelRow["type"];
  if (caps) {
    if (caps.input?.image) type = "vlm";
    else if (caps.output?.text) type = "llm";
  }

  const flags: string[] = [];
  if (caps?.attachment) flags.push("Vision");
  if (caps?.toolcall) flags.push("Tools");
  if (caps?.reasoning) flags.push("Reasoning");
  if (caps?.temperature) flags.push("Temp");

  return {
    id,
    name: readString(model.name) ?? id,
    context: readFiniteNumber(model.limit?.context),
    output: readFiniteNumber(model.limit?.output),
    type,
    flags,
    family: readString(model.family),
    parameterSize: readString(model.parameterSize),
    quantization: readString(model.quantization),
    sizeBytes: readFiniteNumber(model.sizeBytes),
  };
}

/**
 * Collect discoverable provider/model groups from the merged provider list
 * the TUI receives over the SDK. Pure — takes the provider array directly so
 * it can be unit-tested without a live client.
 */
export function collectModelGroups(
  providers: readonly SdkProviderView[],
): ProviderGroup[] {
  const groups: ProviderGroup[] = [];

  for (const provider of providers) {
    if (!looksDiscoverable(provider)) continue;

    const models = provider.models ?? {};
    const rows: ModelRow[] = [];
    for (const [id, model] of Object.entries(models)) {
      if (!id) continue;
      rows.push(toModelRow(id, model));
    }
    if (rows.length === 0) continue;

    rows.sort((a, b) => a.id.localeCompare(b.id));

    groups.push({
      provider: readString(provider.name) ?? provider.id,
      baseURL: readString(provider.options?.baseURL),
      models: rows,
    });
  }

  groups.sort((a, b) => a.provider.localeCompare(b.provider));
  return groups;
}
