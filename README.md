# opencode-lmstudio

Connect OpenCode to LM Studio with runtime-validated model discovery.

The plugin reads LM Studio's native model metadata when OpenCode starts,
configures the `lmstudio` provider, and makes supported local models available
without maintaining a manual model list.

> **v1 release candidate:** `1.0.0-rc.2` is published through npm `next` for
> compatibility testing. Stable npm `latest` remains on `0.3.1`. Track results
> and report feedback in
> [issue #34](https://github.com/agustif/opencode-lmstudio/issues/34).

## Behavior

At startup, the plugin:

1. connects to the configured LM Studio server, or the documented default at
   `http://127.0.0.1:1234`;
2. validates `GET /api/v1/models` against the native LM Studio response shape;
3. adds `llm` records to OpenCode and excludes embedding records;
4. maps the model key, display name, vision support, and effective context;
5. uses the active loaded context when present and the model maximum when the
   model is available for on-demand loading;
6. uses the provider's server and Bearer-token boundary for discovery; and
7. preserves explicit user model overrides and whitelists.

The complete endpoint, field-mapping, output-reserve, tool, reasoning, and
compatibility decisions are recorded in
[the v1 integration contract](./docs/v1-contract.md).

## Requirements

- OpenCode 1.17.7 or newer
- LM Studio 0.4.0 or newer with the local server enabled
- LM Studio native `GET /api/v1/models`
- Node.js `22.22.2`, `24.15.0`, or a supported version from `26` onward; or
  Bun `1.3.5` or newer

## Install

### v1 release candidate

Use the exact version in `opencode.json` for reproducible testing:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-lmstudio@1.0.0-rc.2"]
}
```

The moving prerelease channel is also available:

```sh
npm install opencode-lmstudio@next
# or
bun add opencode-lmstudio@next
```

### Stable channel

The current stable package remains available as:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-lmstudio@0.3.1"]
}
```

Restart OpenCode after changing the configured plugin version.

## Local quick start

1. Enable the LM Studio server.
2. Add the exact plugin version to `opencode.json`.
3. Start OpenCode and select an LM Studio model.

For the default local address, no provider block is required. The plugin adds
`provider.lmstudio` only after validating native LM Studio metadata.

## Custom servers and authentication

Configure the provider for custom ports, private-network servers, reverse
proxies, and authenticated endpoints:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-lmstudio@1.0.0-rc.2"],
  "provider": {
    "lmstudio": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LM Studio",
      "options": {
        "baseURL": "http://127.0.0.1:1234/v1",
        "apiKey": "{env:LM_API_TOKEN}"
      }
    }
  }
}
```

Supported token sources are:

- `provider.lmstudio.options.apiKey`, including OpenCode's `{env:NAME}` syntax;
- `LM_API_TOKEN` on local and private-network servers; and
- `LMSTUDIO_API_KEY` on local and private-network servers for compatibility.

Public hosts require an explicit provider `apiKey`, keeping credential routing
visible in configuration.

## Model mapping

### Chat and vision

Native v1 records with `type: "llm"` become OpenCode chat models. When
`capabilities.vision` is true, the model receives image input and attachment
support. Records with `type: "embedding"` do not enter the chat provider.

The plugin preserves the LM Studio `key` as the model ID and uses
`display_name` as the OpenCode display name. There are no model-family or
model-name heuristics.

### Context limits

For an unloaded model, `max_context_length` becomes OpenCode's context limit so
LM Studio can load the model on demand. For one loaded instance, the instance's
configured `context_length` is used. For multiple instances under one model
key, the plugin uses the minimum active context to avoid overstating any routed
instance.

LM Studio does not report a separate generation limit. The plugin supplies
OpenCode with an explicit conservative output policy: one quarter of effective
context, capped at 8,192 tokens. An explicit user limit always wins.

### Tool training and reasoning

LM Studio documents native and default tool-use modes, and says every model has
at least default tool support. The plugin sets `tool_call: true` for discovered
LLMs rather than treating `trained_for_tool_use: false` as "tools unsupported."
The structured discovery log groups models into `toolUse.native`,
`toolUse.default`, and `toolUse.unknown`, so lower-reliability default handling
is visible without disabling it. Runtime malformed-call detection is not
claimed because LM Studio can return that text as ordinary assistant content.

LM Studio reasoning settings are also left unmapped because OpenCode's
`reasoning` flag is not documented as an equivalent field for the
OpenAI-compatible provider.

### Overrides and whitelists

Explicit model configuration takes precedence over discovery:

```json
{
  "provider": {
    "lmstudio": {
      "models": {
        "publisher/model-id": {
          "name": "My local model",
          "limit": {
            "context": 32768,
            "output": 8192
          }
        }
      },
      "whitelist": ["publisher/model-id"]
    }
  }
}
```

Without an explicit whitelist, the plugin regenerates one from the current
native `llm` records. Models removed from LM Studio do not remain as stale
generated entries on a later configuration load.

## Troubleshooting

Inspect the configuration using OpenCode's parser:

```sh
npm run validate:config -- /path/to/opencode.json
# or
OPENCODE_CONFIG=/path/to/opencode.json opencode debug config
```

OpenCode logs discovery events under the service name `opencode-lmstudio`.
See [DEBUG.md](./DEBUG.md) for native endpoint checks, ACP checks, and repository
verification commands.

## OpenCode screenshots

These are Chromium screenshots of browser xterm.js replaying raw ANSI traces
from the real OpenCode TUI. Microsoft's `@microsoft/tui-test` owns the PTY,
interactions, assertions, and traces; xterm.js supplies the browser terminal
renderer.

![OpenCode home with an LM Studio model](./docs/screenshots/opencode-home.png)

![LM Studio provider models in the OpenCode model picker](./docs/screenshots/opencode-models.png)

![A streamed chat response from the LM Studio fixture](./docs/screenshots/opencode-chat.png)

The suite also captures the
[filtered vision-model search](./docs/screenshots/opencode-model-search.png) and
[selected-model home state](./docs/screenshots/opencode-selected-model.png).

Refresh the sanitized native fixture and screenshots when their contracts
change:

```sh
npm run fixture:capture -- --lm-studio-version <version>
npm run test:tui:update
```

Fixture capture reads the running native v1 API. Captured fixtures retain
capabilities and loaded context but omit model sizes, local paths, and variant
metadata. Each fixture records its LM Studio version and capture date.

## Development

```sh
npm install
npm run validate
npm run test:coverage
npm run smoke:opencode
npm run smoke:opencode:acp
npm run test:tui
npm pack --dry-run
```

`smoke:opencode` exercises plugin loading, native discovery, authentication,
model selection, and chat through a real OpenCode CLI. `smoke:opencode:acp`
uses the official ACP SDK to initialize and create a session while verifying
that every stdout line remains JSON-RPC.

`test:tui` runs OpenCode 1.17.7, the declared minimum, in a real PTY. The
current OpenCode target is pinned separately in `.opencode-version` for CLI and
ACP smoke tests. Raw ANSI traces are stored in `tui-traces/` and rendered by
browser xterm.js.

After a package is public, its native OpenCode resolver/cache path can be tested
without a local shim:

```sh
npm run smoke:opencode:resolver -- opencode-lmstudio@1.0.0-rc.2
npm run smoke:opencode:acp:package -- opencode-lmstudio@1.0.0-rc.2
```

`npm run release` is a read-only preflight. The reviewed release workflow and
post-publication gates are documented in [RELEASE.md](./RELEASE.md).

## License

MIT
