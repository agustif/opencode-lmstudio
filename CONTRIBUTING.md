# Contributing to opencode-actualyze

## Architecture Overview

The plugin is structured as a pipeline that runs during opencode's config hook
at startup. The source files are organized into four concerns:

```
src/
├── constants.ts          # Plugin name, command name
├── index.ts              # Server plugin entry — config-hook discovery
├── tui.ts                # TUI plugin entry — /actualyze dialog command
├── tui-models.ts         # TUI data layer — SDK provider/model → display rows + formatters
├── discover.ts           # Core discovery engine — pipeline orchestrator + table formatter
├── models-dev.ts         # models.dev fallback matching
├── format.ts             # Model name + number/byte formatting utilities
└── probes/
    ├── types.ts           # ProbeModelMeta, ProbeResult, ProviderProbe, ProbeContext
    ├── util.ts            # Shared utilities: buildHeaders, probeFetch, EMPTY_RESULT
    ├── index.ts           # Probe registry + resolveProbe (supports "auto")
    ├── fingerprint.ts     # Server auto-detection (tiered fingerprinting)
    ├── omlx.ts            # oMLX probe implementation
    ├── ollama.ts          # Ollama probe implementation
    ├── vllm.ts            # vLLM probe implementation
    ├── tgi.ts             # TGI probe implementation
    ├── sglang.ts          # SGLang probe implementation
    ├── lmstudio.ts        # LM Studio probe implementation
    └── koboldcpp.ts       # KoboldCpp probe implementation
```

### Plugin Lifecycle

```mermaid
sequenceDiagram
    participant OC as opencode
    participant PI as Plugin Init
    participant DM as discoverModels
    participant FP as Fingerprint
    participant PR as Probe
    participant MD as models.dev

    OC->>PI: Load plugin
    PI->>OC: Return hooks
    OC->>PI: config hook(config)
    PI->>MD: fetchModelsDevIndex(client)
    MD-->>PI: FlatModel[] index
    PI->>DM: discoverModels(config, index)

    loop Each OpenAI-compatible provider
        DM->>DM: fetchModels(baseURL)
        DM->>DM: Categorize by keyword
        alt probe = explicit name
            DM->>PR: probe(baseURL, apiKey, context)
            PR-->>DM: ProbeResult
        else probe = "auto"
            DM->>FP: fingerprint(baseURL, apiKey, modelsResponse)
            FP-->>DM: DetectedServer or undefined
            opt Server detected
                DM->>DM: PROBE_MAP lookup
                DM->>PR: probe(baseURL, apiKey, context)
                PR-->>DM: ProbeResult
            end
        end
        DM->>DM: applyProbeMeta per model
        DM->>DM: applyModelsDevMeta per model
        DM->>DM: Merge into config
    end

    DM-->>PI: Done
    PI-->>OC: Config enriched

    Note over OC,PI: Later, in the TUI process...
    OC->>PI: /actualyze (api.command.register onSelect)
    PI->>PI: collectModelGroups(api.state.provider) + render dialog
    PI-->>OC: api.ui.dialog (model table) — no model turn
```

### Enrichment Pipeline

Each discovered model passes through three enrichment layers. Each layer only
sets fields that aren't already present — later layers never overwrite earlier
ones, and manually configured models are skipped entirely.

```mermaid
flowchart TD
    A["GET /v1/models"] --> B["Keyword Categorization"]
    B --> C{Probe configured?}
    C -->|Explicit name| D["Provider Probe"]
    C -->|"auto"| G["Fingerprint Server"]
    C -->|No| E["models.dev Fallback"]
    G -->|Detected| H["PROBE_MAP lookup"]
    G -->|Not detected| E
    H --> D
    D --> E
    E --> F["Enriched Model Config"]

    style A fill:#e8f4fd
    style D fill:#d4edda
    style E fill:#fff3cd
    style F fill:#f0f0f0
    style G fill:#e8daef
```

**Layer 1 — Keyword categorization** sets basic model type:

- IDs containing "embed" or "embedding" → categorized as embedding
- IDs matching known LLM family names (qwen, llama, gemma, etc.) → chat
- Everything else → unknown

**Layer 2 — Provider probes** (when `options.probe` is set) call
provider-specific APIs for authoritative metadata:

- Context window and output limit
- Model type (LLM/VLM/embedding)
- Capability flags (tools, vision, reasoning)
- Physical metadata (parameter size, quantization, disk size)

When `"probe": "auto"` is set, the plugin fingerprints the server first
(see [Server Auto-Detection](#server-auto-detection)) and maps the detected
server to its probe via `PROBE_MAP`.

**Layer 3 — models.dev fallback** matches model IDs against opencode's built-in
database of ~4,000 cloud models to infer capabilities:

- Only applies capability flags (tool_call, reasoning, attachment, etc.)
- Does NOT apply context/output limits (these vary by quantization/provider)
- Uses 3-tier matching: exact → family+size → family-only

### Data Flow Through `applyProbeMeta`

When a probe returns metadata, `applyProbeMeta()` maps probe fields to opencode
config fields with specific precedence rules:

```mermaid
flowchart LR
    subgraph "ProbeModelMeta"
        ctx["context"]
        mt["maxTokens"]
        mtype["modelType"]
        vis["vision"]
        tc["toolCall"]
        rea["reasoning"]
        tmp["temperature"]
        fam["family"]
        ps["parameterSize"]
        qnt["quantization"]
        sb["sizeBytes"]
    end

    subgraph "Model Config"
        lim["limit.context<br/>limit.output"]
        mod["modalities"]
        att["attachment"]
        tc2["tool_call"]
        rea2["reasoning"]
        tmp2["temperature"]
        fam2["family"]
        ps2["parameterSize"]
        qnt2["quantization"]
        sb2["sizeBytes"]
    end

    ctx --> lim
    mt --> lim
    mtype --> mod
    vis --> att
    tc --> tc2
    rea --> rea2
    tmp --> tmp2
    fam --> fam2
    ps --> ps2
    qnt --> qnt2
    sb --> sb2
```

Key rules:

- `limit` is only set if the model doesn't already have one
- VLM model type → `modalities: { input: ["text", "image"], output: ["text"] }`
  - `attachment: true`
- LLM model type → `modalities: { input: ["text"], output: ["text"] }`
- Capability flags (`tool_call`, `reasoning`, `temperature`) are only set if
  the model doesn't already have them
- Capability flags are never emitted as `false`. An authoritative probe may
  report `false` internally to block conflicting fallback metadata; unknown
  values remain eligible for fallback.

### Server Auto-Detection

When `"probe": "auto"` is configured, the `fingerprint()` function in
`src/probes/fingerprint.ts` identifies the server using a tiered strategy:

```mermaid
flowchart TD
    A["Start fingerprinting"] --> B["Tier 1: Inspect modelsResponse"]
    B --> BA{"Any exact atlas<br/>owner?"}
    BA -->|Yes| RA["actualyze"]
    BA -->|No| B1{"Unanimous owned_by<br/>in OWNED_BY_MAP?"}
    B1 -->|Yes| R2["Matched server"]
    B1 -->|No| B2{"Non-standard fields?<br/>aliases, tags, status"}
    B2 -->|Yes| R1["llamacpp"]
    B2 -->|No| C["Tier 2: Endpoint probes"]
    C --> C1{"GET /info<br/>has router field?"}
    C1 -->|Yes| R3["tgi"]
    C1 -->|No| C2{"GET /api/v1/models<br/>has key + type fields?"}
    C2 -->|Yes| R4["lmstudio"]
    C2 -->|No| D["Tier 3: Low confidence"]
    D --> D1{"GET / or /api/tags<br/>looks like Ollama?"}
    D1 -->|Yes| R5["return undefined"]
    D1 -->|No| R6["return undefined"]

    style B fill:#d4edda
    style C fill:#fff3cd
    style D fill:#f8d7da
```

**Tier 1 -- modelsResponse inspection** (free, no HTTP):

- An exact `owned_by: "atlas"` on any valid entry selects Actualyze, including in a
  mixed catalog. Auto-selected Actualyze probing requests details only for that
  Actualyze-owned subset.
- Other recognized owners must be unanimous across the catalog (`omlx`, `vllm`,
  `sglang`, `llamacpp`, `koboldcpp`, `library` → `ollama`).
- If `owned_by` is unknown or mixed, checks for non-standard fields (`aliases`, `tags`, `status`) that indicate llama.cpp

**Tier 2 -- endpoint probes** (sequential HTTP, 2s global timeout):

- `GET /info` with a `router` field → TGI
- `GET /api/v1/models` with `key` + `type` fields → LM Studio

**Tier 3 -- low confidence** (returns `undefined` silently):

- `GET /` containing "Ollama is running" or `/api/tags` responding with a
  model list returns `undefined` silently.

Once detected, `PROBE_MAP` maps the server to its probe implementation:

| Detected Server | Probe Used |
| --------------- | ---------- |
| actualyze       | actualyze  |
| ollama          | ollama     |
| llamacpp        | ollama     |
| omlx            | omlx       |
| lmstudio        | lmstudio   |
| tgi             | tgi        |
| sglang          | sglang     |
| vllm            | vllm       |
| koboldcpp       | koboldcpp  |

Note that llama.cpp maps to the `ollama` probe because llama.cpp's HTTP server
implements an Ollama-compatible API.

## Building a New Probe

Probes are the most impactful way to contribute. If you run a local inference
server that has a metadata API, you can write a probe for it.

### Probe Contract

Every probe must implement the `ProviderProbe` type signature:

```typescript
type ProviderProbe = (
  baseURL: string, // Normalized, no trailing /v1
  apiKey?: string, // From provider options
  context?: ProbeContext, // Pre-fetched data from the discovery layer
) => Promise<ProbeResult>;

interface ProbeContext {
  /** Pre-fetched /v1/models entries, for probes that need them */
  modelsResponse?: OpenAIModelEntry[];
  /** Whether discovery selected the probe automatically or explicitly */
  probeSelection?: "auto" | "explicit";
  /** Config-hook cancellation signal for probes with external I/O */
  signal?: AbortSignal;
}

interface ProbeResult {
  models: Record<string, ProbeModelMeta>;
}
```

The `context` parameter provides data already fetched by the discovery layer.
Probes can read `context.modelsResponse` to access the `/v1/models` entries
without making a redundant HTTP call. This is especially useful for probes like
vLLM and SGLang where the models response already contains non-standard fields
(e.g., `max_model_len`) with useful metadata.

Probes must follow these rules:

1. **Use `probeFetch()`** from `./util` for all HTTP calls — it handles the
   connection/headers timeout (2s default) and abort signal composition.
2. **Read bodies with `readJson()` / `readBody()`** from `./util`, never raw
   `res.json()` / `res.text()`. The helpers bound the body read with a timeout
   and cancel the stream; a raw read has no timeout and can hang forever if a
   server sends headers then stalls the body.
3. **Never throw** — catch all errors and return `EMPTY_RESULT` from `./util`
   on failure.
4. **Never write to stdout/stderr** (no `console.*`). Probes run in opencode's
   config hook at startup; any output leaks into opencode. Fail silently.
5. **Leave unknown capabilities undefined.** Return `false` only when the
   provider reports an authoritative boolean; discovery uses it to block a
   conflicting fallback and removes the internal sentinel before config merge.

### Step-by-Step

1. Create `src/probes/yourprovider.ts`:

```typescript
import type {
  ProbeModelMeta,
  ProbeResult,
  ProbeContext,
  ProviderProbe,
} from "./types";
import { buildHeaders, probeFetch, readJson, EMPTY_RESULT } from "./util";

export const probeYourProvider: ProviderProbe = async (
  baseURL: string,
  apiKey?: string,
  context?: ProbeContext,
): Promise<ProbeResult> => {
  try {
    // Option A: Use context.modelsResponse if the /v1/models response
    // already contains the metadata you need (e.g., max_model_len)
    if (context?.modelsResponse) {
      const models: Record<string, ProbeModelMeta> = {};
      for (const entry of context.modelsResponse) {
        models[entry.id] = {
          context: (entry as Record<string, unknown>).context_window as
            | number
            | undefined,
          temperature: true,
        };
      }
      return { models };
    }

    // Option B: Call a provider-specific metadata API
    const headers = buildHeaders(apiKey);
    const res = await probeFetch(`${baseURL}/your/metadata/endpoint`, {
      headers,
    });

    if (!res) return EMPTY_RESULT;
    if (!res.ok) return EMPTY_RESULT; // degrade silently — no console output

    // Bounded body read (never raw res.json()).
    const data = await readJson<{ models?: unknown[] }>(res);
    if (!data) return EMPTY_RESULT;
    const models: Record<string, ProbeModelMeta> = {};

    // Map response to ProbeModelMeta per model
    for (const entry of (data.models ?? []) as Record<string, unknown>[]) {
      models[entry.id as string] = {
        context: entry.context_window as number | undefined,
        maxTokens: entry.max_output as number | undefined,
        modelType: entry.supports_vision ? "vlm" : "llm",
        vision: entry.supports_vision ? true : undefined,
        toolCall: entry.supports_tools ? true : undefined,
        temperature: true,
      };
    }

    return { models };
  } catch {
    return EMPTY_RESULT; // never throw, never log
  }
};
```

2. Register it in `src/probes/index.ts`:

```typescript
import { probeYourProvider } from "./yourprovider";

const PROBES: Record<string, ProviderProbe> = {
  omlx: probeOmlx,
  ollama: probeOllama,
  yourprovider: probeYourProvider, // Add this line
};
```

3. Write tests in `test/probes/yourprovider.test.ts` — mock `global.fetch`,
   test success path, error handling, and edge cases. See
   `test/probes/omlx.test.ts` for a template.

4. Update the README probe documentation.

### ProbeModelMeta Fields

All fields are optional. Set what your provider can report:

| Field           | Type                            | Description                           |
| --------------- | ------------------------------- | ------------------------------------- |
| `context`       | `number`                        | Context window in tokens              |
| `maxTokens`     | `number`                        | Maximum output tokens                 |
| `modelType`     | `"llm" \| "vlm" \| "embedding"` | Model classification                  |
| `toolCall`      | `boolean`                       | Supports function/tool calling        |
| `reasoning`     | `boolean`                       | Supports extended thinking mode       |
| `temperature`   | `boolean`                       | Supports temperature parameter        |
| `vision`        | `boolean`                       | Supports image input                  |
| `loaded`        | `boolean`                       | Currently loaded in memory            |
| `sizeBytes`     | `number`                        | Model file size on disk               |
| `parameterSize` | `string`                        | Human-readable param count ("30.5B")  |
| `family`        | `string`                        | Model family ("qwen3", "llama")       |
| `quantization`  | `string`                        | Quantization level ("Q4_K_M", "4bit") |

### What Makes a Good Probe

- **Fast** — complete in under 2 seconds even with many models
- **Parallel** — if per-model calls are needed (like Ollama's `/api/show`),
  use `Promise.allSettled()` to call them concurrently
- **Resilient** — partial failures should not prevent other models from being
  enriched. If one model's metadata call fails, the others should still work.
- **Accurate** — only report what the provider API confirms. Don't guess
  capabilities that aren't explicitly reported.

## Adding New Server Fingerprints

If you're adding support for a new server type that should be auto-detected
via `"probe": "auto"`, you need to update three things in
`src/probes/fingerprint.ts`:

### 1. Add to `OWNED_BY_MAP` (Tier 1)

If the server sets a distinctive `owned_by` value in its `/v1/models` response,
add it to the map for free detection with no HTTP overhead:

```typescript
const OWNED_BY_MAP: Record<string, DetectedServer> = {
  omlx: "omlx",
  vllm: "vllm",
  // ...
  yourserver: "yourserver", // Add this line
};
```

### 2. Add a Tier 2 endpoint probe (if needed)

If the server cannot be identified by `owned_by` alone, add a Tier 2 check
that probes a server-specific endpoint. Add it to the sequential probe chain
in the `fingerprint()` function, before the Tier 3 section:

```typescript
// Step N: GET /your/unique/endpoint → YourServer
try {
  const res = await probeFetch(`${baseURL}/your/unique/endpoint`, {
    headers,
    signal: combinedSignal,
    timeoutMs: 1000,
  });
  if (res?.ok) {
    // Bounded body read (never raw res.json()).
    const data = await readJson<Record<string, unknown>>(res, 1000);
    if (data && /* response shape is unique to this server */) {
      return "yourserver";
    }
  }
} catch {
  // JSON parse failure — continue
}
```

### 3. Update `PROBE_MAP`

Map the detected server to the probe implementation that should handle it:

```typescript
export const PROBE_MAP: Record<DetectedServer, ProbeKey> = {
  // ...
  yourserver: "yourserver", // Maps to the probe registered in PROBES
};
```

If the new server is API-compatible with an existing probe (like llama.cpp
using the ollama probe), map it to the existing probe key instead.

### 4. Update types

Add the new server name to both the `DetectedServer` and `ProbeKey` union
types (if it uses its own probe) at the top of `fingerprint.ts`.

## models.dev Matching

The `src/models-dev.ts` module handles fallback enrichment when no probe is
available. Understanding its matching logic is important if you're debugging
why a model did or didn't get capabilities applied.

### Matching Strategy

```mermaid
flowchart TD
    A["Local model ID<br/>#quot;qwen3:0.6b#quot;"] --> B["Normalize<br/>#quot;qwen3-0.6b#quot;"]
    B --> C{"Exact match in<br/>models.dev index?"}
    C -->|Yes| D["Return metadata"]
    C -->|No| E["Extract family: #quot;qwen#quot;<br/>Extract size: #quot;0.6b#quot;"]
    E --> F{"Family + size<br/>match?"}
    F -->|Yes| D
    F -->|No| G{"Family-only<br/>match?"}
    G -->|Yes| D
    G -->|No| H["No match<br/>return undefined"]

    style D fill:#d4edda
    style H fill:#f8d7da
```

**Normalization** strips the owner prefix (`qwen/qwen3-30b` → `qwen3-30b`),
replaces `:` with `-`, and lowercases.

**Family extraction** takes the leading alphabetic characters: `qwen3` →
`qwen`, `deepseek-r1` → `deepseek`, `llama-3.2` → `llama`.

**Size extraction** finds the first number+suffix pattern: `qwen3:0.6b` →
`0.6b`, `qwen3-30b-a3b` → `30b`. Size matching uses word boundaries to
prevent `4b` from matching inside `14b`.

### What models.dev Applies

Only capability flags — never limits:

| Applied       | NOT applied     |
| ------------- | --------------- |
| `tool_call`   | `limit.context` |
| `reasoning`   | `limit.output`  |
| `attachment`  | `cost`          |
| `temperature` |                 |
| `family`      |                 |
| `modalities`  |                 |

Context and output limits vary dramatically by quantization level and provider,
so they can only come from probes.

## Development

### Prerequisites

- Node.js 22+
- npm

### Setup

```bash
git clone https://github.com/actualyze-ai/opencode-actualyze.git
cd opencode-actualyze
npm install
```

### Commands

```bash
npm run check        # typecheck + lint + format:check + test (CI gate)
npm run fix          # eslint --fix + prettier --write (auto-fix everything)
npm run lint         # ESLint only
npm run lint:fix     # ESLint with auto-fix
npm run format       # Prettier write
npm run format:check # Prettier check only
npm run typecheck    # TypeScript type checking only
npm run test:run     # Run tests once
npm run test         # Run tests in watch mode
npm run compile      # Build dist/ via tsup
npm run build        # check + compile (full validation + build)
```

### Git Hooks

Husky hooks run automatically:

- **pre-commit** — `lint-staged` runs ESLint --fix and Prettier on staged files
- **pre-push** — `npm run check` (full validation gate)

### Testing

Tests use [vitest](https://vitest.dev/) with `globals: true`. All network
calls are mocked via `vi.fn()` on `global.fetch`.

```bash
# Run a specific test file
npx vitest run test/probes/omlx.test.ts

# Run with coverage
npm run test:coverage
```

### Testing Against Live Providers

If you have oMLX or Ollama running locally, you can verify probe output
manually:

```bash
# oMLX (requires auth)
curl -s http://localhost:8000/v1/models/status \
  -H "Authorization: Bearer your-key" | jq .

# Ollama — list models
curl -s http://localhost:11434/api/tags | jq .

# Ollama — show model details
curl -s http://localhost:11434/api/show \
  -d '{"model":"qwen3:0.6b"}' | jq .
```

### Project Structure

```
opencode-actualyze/
├── src/
│   ├── constants.ts       # Single source of truth for all naming strings
│   ├── index.ts            # Server plugin entry — config-hook discovery
│   ├── tui.ts              # TUI plugin entry — /actualyze dialog command
│   ├── tui-models.ts       # TUI data layer — SDK models → rows + formatters
│   ├── discover.ts         # Pipeline orchestrator + table formatter (largest file)
│   ├── models-dev.ts       # models.dev index + matching
│   ├── format.ts           # Model name + number/byte prettification
│   └── probes/
│       ├── types.ts         # Shared types (ProbeModelMeta, ProbeContext)
│       ├── util.ts          # Shared probe utilities
│       ├── index.ts         # Registry + resolveProbe (supports "auto")
│       ├── fingerprint.ts   # Server auto-detection (tiered)
│       ├── omlx.ts          # oMLX probe
│       ├── ollama.ts        # Ollama probe
│       ├── vllm.ts          # vLLM probe
│       ├── tgi.ts           # TGI probe
│       ├── sglang.ts        # SGLang probe
│       ├── lmstudio.ts      # LM Studio probe
│       └── koboldcpp.ts     # KoboldCpp probe
├── test/
│   ├── probes/
│   │   ├── omlx.test.ts
│   │   ├── ollama.test.ts
│   │   ├── fingerprint.test.ts
│   │   ├── vllm.test.ts
│   │   ├── tgi.test.ts
│   │   ├── sglang.test.ts
│   │   ├── lmstudio.test.ts
│   │   ├── koboldcpp.test.ts
│   │   └── util.test.ts
│   ├── discover.test.ts
│   ├── format.test.ts
│   ├── format-table.test.ts
│   ├── tui.test.ts
│   ├── tui-models.test.ts
│   └── models-dev.test.ts
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── eslint.config.js
├── .prettierignore
├── .husky/
│   ├── pre-commit
│   └── pre-push
├── .github/workflows/
│   ├── release.yml          # Tag → check + compile + npm publish + GitHub Release
│   └── latest.yml           # Main push → check + rolling snapshot release
├── AGENTS.md
├── README.md
├── CONTRIBUTING.md
└── LICENSE
```

### Naming Convention

All naming strings (plugin name, command name) are defined in
`src/constants.ts`. If the plugin needs to be renamed, only that file changes:

```typescript
export const PLUGIN_NAME = "opencode-actualyze";
export const COMMAND_NAME = "actualyze";
```

### Commit Style

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add LM Studio probe
fix: size matching false-positive on 4b/14b
docs: update probe comparison table
test: add coverage for empty model list
```
