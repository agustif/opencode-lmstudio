# opencode-actualyze

[![npm version](https://img.shields.io/npm/v/opencode-actualyze)](https://www.npmjs.com/package/opencode-actualyze)
[![CI](https://github.com/actualyze-ai/opencode-actualyze/actions/workflows/release.yml/badge.svg)](https://github.com/actualyze-ai/opencode-actualyze/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An [opencode](https://github.com/opencode-ai/opencode) plugin that
auto-discovers models from OpenAI-compatible providers and enriches them with
context window sizes, capability flags, and model metadata. Supports Actualyze,
Ollama, oMLX, vLLM, TGI, SGLang, LM Studio, KoboldCpp, llama.cpp, and LocalAI.

## Quick Start

```bash
opencode plugin opencode-actualyze
```

Then add `"probe": "auto"` to any provider in your `opencode.json`:

```json
{
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://localhost:11434/v1",
        "probe": "auto"
      }
    }
  }
}
```

Restart opencode. Every model on that provider now has accurate context window
sizes, output limits, and capability flags (tool calling, vision, reasoning)
discovered automatically.

## The Problem

Local AI providers expose models through a generic OpenAI-compatible API that
reports almost nothing about what each model can actually do. When you run
Ollama, oMLX, LM Studio, or any other inference server, opencode discovers
model IDs like `qwen3:30b-a3b` or `gemma3-12b-it` — but has no idea whether
they support tool calling, vision input, extended thinking, or what their
actual context window is. Without this metadata, opencode can't make informed
decisions about which model to use, what features to enable, or how much
context it can send.

**opencode-actualyze** fixes this by building a 3-layer metadata enrichment
pipeline that runs at startup. It discovers every available model, probes
provider-specific APIs for authoritative metadata, and falls back to the
[models.dev](https://models.dev) database for anything the probes can't reach.
The result: every discovered model gets accurate context limits, capability
flags, and modality information — automatically, with zero manual configuration.

## How It Works

The plugin runs during opencode's config hook (before any session starts) and
enriches model entries through three layers, applied in order:

1. **Discovery + keyword categorization** — Queries `GET /v1/models` on every
   OpenAI-compatible provider to get the raw model list. Model IDs are
   categorized as chat, embedding, or unknown based on name patterns.

2. **Provider-specific probes** — When a provider has `"probe": "actualyze"`,
   `"probe": "omlx"`, or another supported probe in its options, a purpose-built
   probe calls provider-specific APIs that expose metadata the generic OpenAI
   API does not. Probes are the most authoritative source and override keyword
   guesses.

3. **models.dev fallback** — For any model that still has gaps after probing,
   the plugin matches the model ID against opencode's built-in
   [models.dev](https://models.dev) database (~4,000 models) using family +
   parameter size matching. This fills in capability flags like `tool_call`,
   `reasoning`, and `attachment` for models the probes don't cover.

Each layer only sets fields that aren't already present — manually configured
metadata in your `opencode.json` is never overwritten, and probes always take
priority over models.dev guesses.

## Installation

**The `opencode plugin` CLI is the recommended way to install in every case.**
It reads the package manifest and registers the plugin in **both**
`opencode.json` (the server plugin that runs model discovery) **and**
`tui.json` (the TUI plugin that provides the `/actualyze` dialog) for you. The
spec it accepts can be an npm name, a `github:` reference, or a local
`file://` path:

```bash
# From npm
opencode plugin opencode-actualyze

# From GitHub
opencode plugin github:actualyze-ai/opencode-actualyze

# From a local checkout (development)
opencode plugin file:///absolute/path/to/opencode-actualyze
```

After installation, add provider configuration with the `probe` field — see
[Configuration](#configuration) below.

> **Why two files?** opencode loads **server** plugins from the `plugin` array
> in `opencode.json` and **TUI** plugins from a _separate_ `plugin` array in
> `tui.json`. The server side drives startup model discovery; the TUI side
> drives the `/actualyze` dialog. `opencode plugin …` writes both. If you
> configure the plugin by hand, you **must** add it to both files or the
> `/actualyze` command will not appear (see [Manual configuration](#manual-configuration)).

### Manual configuration

If you prefer to edit config by hand (or install the package yourself), add the
plugin to **both** files. Use the same spec in each — an npm name, a `github:`
reference, or a `file://` path:

`~/.config/opencode/opencode.json` (server — model discovery):

```json
{
  "plugin": ["opencode-actualyze"]
}
```

`~/.config/opencode/tui.json` (TUI — the `/actualyze` dialog):

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-actualyze"]
}
```

To install the package itself from npm before referencing it:

```bash
npm install opencode-actualyze
```

For a local checkout, clone and build first, then reference the directory with a
`file://` path in both config files:

```bash
git clone https://github.com/actualyze-ai/opencode-actualyze.git
cd opencode-actualyze
npm install
npm run compile
```

```json
{
  "plugin": ["file:///absolute/path/to/opencode-actualyze"]
}
```

## Configuration

### Basic: Discovery Only (No Probe)

Any `@ai-sdk/openai-compatible` provider gets automatic model discovery. Models
are enriched with whatever models.dev can match:

```json
{
  "provider": {
    "my-server": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://localhost:8000/v1"
      }
    }
  }
}
```

### With a Probe: Full Metadata

Add `"probe"` to the provider's `options` to enable provider-specific metadata
extraction. The probe field **must** be inside `options`, not at the provider
top level, because opencode's provider schema rejects unknown top-level fields.

You can specify an explicit probe name or use `"auto"` to let the plugin
detect the server type automatically:

```json
{
  "provider": {
    "omlx": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://localhost:8000/v1",
        "apiKey": "your-key",
        "probe": "omlx"
      }
    },
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://localhost:11434/v1",
        "probe": "ollama"
      }
    },
    "local": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://localhost:5000/v1",
        "probe": "auto"
      }
    }
  }
}
```

When `"probe": "auto"` is set, the plugin fingerprints the server using a
tiered detection strategy (see [Supported Servers](#supported-servers)) and
selects the appropriate probe automatically. If detection fails, the provider
still gets discovery + models.dev fallback enrichment.

Actualyze can also be selected explicitly with `"probe": "actualyze"`. In auto
mode, the plugin recognizes Actualyze-served entries in the `/v1/models`
response automatically, even in mixed catalogs. Other recognized owners still
require unanimous ownership.

### Multiple Providers

The plugin processes every provider in your config independently. You can mix
probed and unprobed providers freely:

```json
{
  "provider": {
    "omlx": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://localhost:8000/v1",
        "apiKey": "strata",
        "probe": "omlx"
      }
    },
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://localhost:11434/v1",
        "probe": "ollama"
      }
    },
    "lmstudio": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://localhost:1234/v1"
      }
    }
  }
}
```

In this example, oMLX and Ollama get full probe enrichment. LM Studio gets
discovery + models.dev fallback. You could also use `"probe": "auto"` on any
of these to let the plugin detect the server type automatically.

## Supported Servers

| Server        | Probe       | Status   | What It Extracts                                                        |
| ------------- | ----------- | -------- | ----------------------------------------------------------------------- |
| **Actualyze** | `actualyze` | Tested   | Context, output limit, vision, tools, reasoning from thinking signals   |
| **oMLX**      | `omlx`      | Tested   | Context, output limit, model type, load state, size                     |
| **Ollama**    | `ollama`    | Tested   | Context, tools, vision, thinking, family, quantization                  |
| **llama.cpp** | `ollama`    | Expected | Partial Ollama metadata (API compat unverified against live instance)   |
| **LocalAI**   | `ollama`    | Expected | Partial Ollama metadata (API compat unverified against live instance)   |
| **LM Studio** | `lmstudio`  | Untested | Context, vision, tool use, architecture, quantization, size, load state |
| **TGI**       | `tgi`       | Untested | Context, output limit                                                   |
| **SGLang**    | `sglang`    | Untested | Context, model type, vision                                             |
| **vLLM**      | `vllm`      | Untested | Context                                                                 |
| **KoboldCpp** | `koboldcpp` | Untested | Context, vision                                                         |

### Support Tiers

- **Tested** -- verified against a live instance
- **Expected** -- API-compatible based on server source code review; not yet tested against a live instance
- **Untested** -- probe implemented based on API documentation; needs community verification

The Actualyze probe reuses the `/v1/models` response, then fetches encoded
`/v1/models/{id}` detail endpoints with a bounded worker pool. Requests inherit
the config-hook abort signal, and one failed model does not discard metadata
from the others. Auto-selected probes request details only for Actualyze-owned
entries in a mixed catalog; an explicit `"probe": "actualyze"` remains an
all-model manual override. Foreign-owner entries remain discovered and use the
normal models.dev fallback. The probe is tested against a live Actualyze endpoint.

### models.dev Fallback

When no probe is configured (or for capability gaps that probes don't cover),
the plugin matches discovered model IDs against opencode's built-in
[models.dev](https://models.dev) database using a 3-tier matching strategy:

1. **Exact normalized match** — `qwen3-30b-a3b` matches directly
2. **Family + size match** — `qwen3:0.6b` → family "qwen" + size "0.6b" →
   matches a qwen model with the same parameter count
3. **Family-only match** — `qwen3:14b` → family "qwen" → inherits
   capabilities from any known qwen model

The fallback only applies **capability flags** (`tool_call`, `reasoning`,
`attachment`, `temperature`, `modalities`, `family`). It does **not** apply
context or output limits — those vary too much across quantization levels and
providers to be guessed reliably.

Actualyze reports capability booleans authoritatively. A reported `false` blocks a
models.dev fallback from enabling that capability, but the final opencode config
still omits false flags. Missing, malformed, or otherwise unknown values remain
eligible for fallback enrichment.

## `/actualyze` Command

Inspect the discovered models in a TUI dialog:

```
/actualyze    Open a dialog listing discovered models with metadata
```

Selecting `/actualyze` from the slash autocomplete opens a scrollable dialog —
it never sends a message to the model and never starts an assistant turn. Press
**`esc`** to close it.

Models are grouped by provider. Each model is shown on two compact lines: its id
on the first, and a detail line with model type, context/output limits (compact,
e.g. `ctx 262K`), on-disk size, capability flags (Vision, Tools, Reasoning), and
provenance (family, parameter size, quantization). Example contents:

```
Actualyze

oMLX (local) — 3 models
  gemma-4-26b-a4b-it-4bit
    vlm  ·  ctx 262K  ·  out 33K  ·  Vision Tools Reasoning  ·  gemma
  GLM-4.7-Flash-MLX-8bit
    llm  ·  ctx 203K  ·  out 33K  ·  Tools Reasoning
  qwen3-coder-next
    llm  ·  ctx 262K  ·  out 33K  ·  43.8 GB  ·  Tools  ·  qwen 30B MXFP4
```

> **Requires a TUI-capable opencode.** The command is registered through
> opencode's TUI plugin command API; the model-discovery and enrichment that
> happen at startup work everywhere, but on a host without the TUI plugin
> runtime the `/actualyze` command simply does not appear. The dialog lists
> every model from OpenAI-compatible/local providers in the merged config — it
> does not separately label already-configured or skipped models, since that
> discovery-only framing is not exposed to the TUI process.

## Timeouts and Resilience

The plugin is designed to never block opencode startup:

- **Individual fetch calls** use a 3-second timeout (model list) or 2-second
  timeout (probes), all via the shared `probeFetch()` wrapper
- **The entire config hook** has a 5-second abort timeout. Model-list requests,
  fingerprinting, and Actualyze detail requests consume that signal. Legacy probes
  remain bounded by their individual request and body-read timeouts.
- **Per-provider isolation** — each provider is wrapped in its own try-catch,
  so a failing provider never prevents discovery for other providers
- **Per-model Actualyze isolation** — detail requests use bounded concurrency and
  individual timeouts; a failure only skips enrichment for that model
- **All errors are caught and isolated** — a failing probe, an offline provider,
  or a malformed response never crashes the plugin or prevents opencode from
  starting
- **Capability flags are never emitted as `false`** — an authoritative probe
  value can block fallback internally, while unknown values remain eligible for
  enrichment

## Manually Configured Models

Models you explicitly configure in `opencode.json` are **never modified** by
the plugin. If you have:

```json
{
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://localhost:11434/v1",
        "probe": "ollama"
      },
      "models": {
        "qwen3:30b": {
          "name": "My Custom Qwen",
          "limit": { "context": 8192, "output": 2048 }
        }
      }
    }
  }
}
```

The plugin will discover any **other** models Ollama has available and enrich
them, but `qwen3:30b` keeps your custom name and limits untouched.

## License

MIT. Based on [opencode-model-scout](https://github.com/rmk40/opencode-model-scout).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for architecture details, how to build
new probes, and development workflow.
