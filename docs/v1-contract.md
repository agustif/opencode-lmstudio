# v1 integration contract

This document records the external API decisions behind `opencode-lmstudio`
1.0. It is the implementation and test contract, not an inferred description
of similarly named fields.

## Supported versions

- LM Studio 0.4.0 or newer. Version 0.4.0 introduced the native REST API v1
  and API-token authentication.
- OpenCode 1.17.7 or newer. `1.17.7` is the minimum compatibility target and
  `1.17.9` is the current target for this release candidate.
- ACP TypeScript SDK 0.21.0 for the stdio compatibility gate. This is the exact
  ACP dependency in OpenCode 1.17.7 and 1.17.9.

Stable `opencode-lmstudio@0.3.1` remains available for installations that need
the earlier LM Studio integration. The 1.0 line does not silently fall back to
LM Studio's previous `/api/v0` shape.

## Endpoint boundaries

| Purpose | Endpoint | Contract |
| --- | --- | --- |
| Model discovery | `GET /api/v1/models` | LM Studio native REST v1 |
| Chat inference | `/v1/chat/completions` | LM Studio OpenAI-compatible API |

Discovery requires a JSON object containing a `models` array. An HTTP 2xx
response with an error object or any other shape is rejected. This is required
because LM Studio 0.4.16 can return HTTP 200 with an error body for an unknown
endpoint. Authentication failures, timeouts, invalid JSON, and invalid schemas
do not trigger a request to another endpoint.

Automatic discovery checks only LM Studio's documented default address,
`http://127.0.0.1:1234`. Custom ports and remote servers are explicit through
`provider.lmstudio.options.baseURL`.

## Model mapping

| LM Studio native v1 field | OpenCode field | Policy |
| --- | --- | --- |
| `key` | model map key and `id` | Preserve exactly |
| `display_name` | `name` | Use the server's display name |
| `type: "llm"` | chat model | Include |
| `type: "embedding"` | none | Exclude from the chat provider |
| `capabilities.vision` | `attachment`, input modalities | Add image input only when true |
| `max_context_length` | `limit.context` | Use when no instance is loaded |
| loaded `config.context_length` | `limit.context` | Use one active value, or the minimum for multiple instances |

The active context is also capped by `max_context_length`. A model key can
refer to more than one loaded instance, while OpenCode has one limit per model
key; the minimum active allocation is therefore the only safe value that does
not overstate a routed instance.

LM Studio does not report a distinct maximum generation length. OpenCode
requires `limit.output` when `limit.context` is supplied, so the plugin applies
an explicit conservative policy: one quarter of effective context, capped at
8,192 tokens. This is plugin policy, not LM Studio metadata. Explicit user
limits override it.

`capabilities.trained_for_tool_use` reports whether a model was trained
natively for tool use. LM Studio separately documents a default tool-use path
for other models, and OpenCode defaults an omitted `tool_call` field to true.
The plugin therefore does not translate a false training flag into
`tool_call: false`.

LM Studio's `capabilities.reasoning` describes its public reasoning settings.
OpenCode's `reasoning` boolean controls provider behavior and is not documented
as an equivalent field for the OpenAI-compatible provider. The plugin leaves it
unset until the two projects publish an interoperable mapping.

## Authentication

Discovery and inference use the same server root and Bearer-token boundary.
An explicit `provider.lmstudio.options.apiKey` always wins and supports
OpenCode's `{env:NAME}` syntax. On loopback, private-network, `.local`, and
`.localhost` servers, automatic lookup checks LM Studio's documented
`LM_API_TOKEN`, then the compatibility name `LMSTUDIO_API_KEY`. Public hosts
require an explicit provider key.

No credentials, response bodies, model paths, or token values are included in
structured logs.

## OpenCode package and ACP boundaries

OpenCode 1.17.7 installs npm plugin specs into its own XDG cache, resolves the
package export/main entrypoint, checks `engines.opencode`, and accepts the
plugin's named legacy function export. Release tests must provide the exact
`opencode-lmstudio@<version>` spec directly to OpenCode in a clean HOME/XDG
environment; an absolute local plugin shim is a separate source/package test.
Before publication, an isolated read-through registry serves the packed
candidate under its exact npm version so the same OpenCode resolver/cache path
is exercised without publishing mutable test bytes.

`opencode acp` uses newline-delimited JSON-RPC over stdin/stdout. The ACP gate
uses SDK 0.21.0 to initialize the connection and create a session, records every
stdout line, and rejects non-JSON-RPC output. Plugin diagnostics use
`client.app.log`; they must not be printed to ACP stdout.

## Primary evidence

- [LM Studio native REST API](https://lmstudio.ai/docs/developer/rest)
- [LM Studio `GET /api/v1/models`](https://lmstudio.ai/docs/developer/rest/list)
- [LM Studio model loading and `context_length`](https://lmstudio.ai/docs/developer/rest/load)
- [LM Studio API-token authentication](https://lmstudio.ai/docs/developer/core/authentication)
- [LM Studio OpenAI-compatible endpoints](https://lmstudio.ai/docs/developer/openai-compat)
- [OpenCode providers and model limits](https://opencode.ai/docs/providers)
- [OpenCode plugins](https://opencode.ai/docs/plugins/)
- [OpenCode ACP](https://opencode.ai/docs/acp/)
- [OpenCode source](https://github.com/anomalyco/opencode)
- [ACP TypeScript SDK](https://github.com/agentclientprotocol/typescript-sdk)

The contract was reconciled against LM Studio docs commit
`18ed548e7e383db5e9ce836ee93d63b8f113a598`, LM Studio JS SDK commit
`f6d63840be12d11a8804510659c1b84c33cbde5b`, OpenCode tags `v1.17.7`
(`4ed4f749e644ffb5b279fb30b7b915e743d80142`) and `v1.17.9`
(`5c23e88419c4743b9be42cea132f2fb1e6cb63ff`), the official ACP SDK 0.21.0 package, LM Studio 0.4.16+2 running
locally, and official OpenCode 1.17.7 package-resolution behavior on
2026-06-21.
