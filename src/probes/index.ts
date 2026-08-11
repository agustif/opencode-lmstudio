import type { ProviderProbe, ProbeContext } from "./types";
import { probeOmlx } from "./omlx";
import { probeOllama } from "./ollama";
import { probeVllm } from "./vllm";
import { probeTgi } from "./tgi";
import { probeSglang } from "./sglang";
import { probeLmstudio } from "./lmstudio";
import { probeKoboldcpp } from "./koboldcpp";
import { probeActualyze } from "./actualyze";
import { fingerprint, PROBE_MAP } from "./fingerprint";
import type { DetectedServer } from "./fingerprint";

/**
 * Registry of provider-specific metadata probes.
 *
 * Activated via the `"probe"` field inside a provider's `options` in opencode.json:
 *
 * ```json
 * {
 *   "provider": {
 *     "my-omlx": {
 *       "npm": "@ai-sdk/openai-compatible",
 *       "options": {
 *         "baseURL": "http://localhost:8000/v1",
 *         "probe": "omlx"
 *       }
 *     }
 *   }
 * }
 * ```
 *
 * The field MUST be inside `options` (not at the provider top level) because
 * opencode's `Config.Provider` schema uses `.strict()` and rejects unknown
 * top-level fields, while `options` uses `.catchall(z.any())`.
 */
const PROBES = {
  actualyze: probeActualyze,
  omlx: probeOmlx,
  ollama: probeOllama,
  vllm: probeVllm,
  tgi: probeTgi,
  sglang: probeSglang,
  lmstudio: probeLmstudio,
  koboldcpp: probeKoboldcpp,
} as const satisfies Record<string, ProviderProbe>;

/** Probe key derived from the registry — stays in sync automatically. */
export type ProbeKey = keyof typeof PROBES;

/** Result of resolving a probe, including optional auto-detection info. */
export interface ResolvedProbe {
  probe: ProviderProbe | undefined;
  detectedServer?: DetectedServer;
}

/**
 * Resolve a probe by type. Supports:
 * - Explicit probe names (e.g., "omlx", "ollama")
 * - "auto" — fingerprint the server and map to a probe
 * - undefined — return no probe
 */
export async function resolveProbe(
  type: string | undefined,
  baseURL: string,
  apiKey?: string,
  context?: ProbeContext,
  signal?: AbortSignal,
): Promise<ResolvedProbe> {
  if (!type) return { probe: undefined };
  // Legacy key from the upstream plugin's docs; migrated configs keep enriching.
  if (type === "atlas") type = "actualyze";
  if (type === "auto") {
    const detected = await fingerprint(
      baseURL,
      apiKey,
      context?.modelsResponse,
      signal,
    );
    if (!detected) return { probe: undefined };
    const probeKey = PROBE_MAP[detected];
    return { probe: PROBES[probeKey], detectedServer: detected };
  }
  if (Object.hasOwn(PROBES, type)) {
    return { probe: PROBES[type as ProbeKey] };
  }
  return { probe: undefined };
}

export type {
  ProviderProbe,
  ProbeResult,
  ProbeModelMeta,
  ProbeContext,
  OpenAIModelEntry,
} from "./types";
export type { DetectedServer } from "./fingerprint";
