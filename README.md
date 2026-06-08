# opencode-lmstudio

OpenCode plugin for enhanced LM Studio support with auto-detection, dynamic model discovery, and API key authentication.

## Features

- **Auto-detection**: Automatically detects LM Studio running on common ports (1234, 8080, 11434)
- **Dynamic Model Discovery**: Queries LM Studio's `/v1/models` endpoint to discover available models
- **API Key Authentication**: Supports LM Studio servers that require Bearer token authentication
- **Embedding Model Filtering**: Skips embedding-only models in OpenCode's chat model list
- **Loaded Model Whitelist**: Limits the LM Studio provider list to discovered, non-embedding models unless you configure your own whitelist
- **Multimodal Metadata**: Marks recognized vision/multimodal LLMs with text and image input support
- **Smart Model Formatting**: Automatically formats model names for better readability (e.g., "Qwen3 30B A3B" instead of "qwen/qwen3-30b-a3b")
- **Organization Owner Extraction**: Extracts and sets `organizationOwner` field from model IDs
- **Health Check Monitoring**: Verifies LM Studio is accessible before attempting operations
- **Automatic Configuration**: Auto-creates `lmstudio` provider if detected but not configured
- **Model Merging**: Intelligently merges discovered models with existing configuration
- **Comprehensive Caching**: Reduces API calls with intelligent caching system
- **Error Handling**: Smart error categorization with auto-fix suggestions

## Installation

```zsh
npm install opencode-lmstudio
# or
bun add opencode-lmstudio
```

Use a versioned plugin spec in `opencode.json`. Replace `0.3.1` with the released version you installed. This creates a version-specific OpenCode plugin cache entry and avoids reusing a stale `@latest` cache after upgrades.

## Usage

Add the plugin to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-lmstudio@0.3.1"
  ],
  "provider": {
    "lmstudio": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LM Studio (local)",
      "options": {
        "baseURL": "http://127.0.0.1:1234/v1"
      }
    }
  }
}
```

### Auto-detection

If you don't configure the `lmstudio` provider, the plugin will automatically detect LM Studio if it's running on one of the common ports and create the provider configuration for you.

### API Key Authentication

If your LM Studio server requires authentication, provide the token through the provider configuration:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-lmstudio@0.3.1"
  ],
  "provider": {
    "lmstudio": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LM Studio (local)",
      "options": {
        "baseURL": "http://127.0.0.1:1234/v1",
        "apiKey": "{env:LMSTUDIO_API_KEY}"
      }
    }
  }
}
```

Then start OpenCode from a shell where the environment variable is available:

```zsh
export LMSTUDIO_API_KEY="your-lm-studio-token"
opencode
```

For compatibility, the plugin also checks `LM_API_TOKEN` when no `apiKey` is configured.

Environment-variable fallback is only used for local or private-network LM Studio URLs such as `localhost`, `127.0.0.1`, `192.168.x.x`, `10.x.x.x`, `172.16.x.x` through `172.31.x.x`, IPv4 link-local addresses, IPv6 local/private IP literals such as `[::1]`, `[fc00::1]`, `[fd00::1]`, and `[fe80::1]`, and `.local` hostnames. Public DNS hostnames are not treated as private just because they start with `fc`, `fd`, or `fe80`. For public or hosted endpoints, configure `options.apiKey` explicitly, for example with `{env:LMSTUDIO_API_KEY}`. This avoids accidentally sending a local LM Studio token to an unintended public URL.

The plugin intentionally does not fall back to `OPENAI_API_KEY`. LM Studio can run on a local network host, and reusing a cloud OpenAI key for a local/LAN endpoint would be easy to do accidentally.

### Manual Configuration

You can also manually configure the provider with specific models:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-lmstudio@0.3.1"
  ],
  "provider": {
    "lmstudio": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LM Studio (local)",
      "options": {
        "baseURL": "http://127.0.0.1:1234/v1"
      },
      "models": {
        "google/gemma-3n-e4b": {
          "name": "Gemma 3n-e4b (local)"
        }
      }
    }
  }
}
```

The plugin will automatically discover and add any additional models available in LM Studio that aren't already configured.

Embedding-only models are skipped because OpenCode's chat model configuration does not support an embedding output modality. When you do not configure your own `provider.lmstudio.whitelist`, the plugin sets one from the discovered non-embedding models. This hides OpenCode's built-in LM Studio defaults when they are not actually returned by LM Studio. Recognized multimodal model IDs, such as vision, VL, omni, LLaVA, Pixtral, and Gemma 3/4 variants, are registered with text and image input support. Other discovered LLMs are registered as text-in/text-out models.

## Testing Unpublished Changes

When testing an unpublished change, avoid using only the package name in `opencode.json`:

```json
"plugin": [
  "opencode-lmstudio"
]
```

OpenCode resolves package-name plugin specs through its package/plugin cache and npm resolution path. Unqualified names such as `opencode-lmstudio` use OpenCode's `@latest` cache slot, which can keep loading a stale package after an upgrade. Published releases should therefore use a versioned spec such as `opencode-lmstudio@0.3.1`.

To test an unpublished change in a release-like way without pointing OpenCode directly at the repository checkout, create a package tarball:

```zsh
mkdir -p ~/.config/opencode/packages
npm pack --pack-destination ~/.config/opencode/packages
```

The package build emits JavaScript into `dist/` and the published package exports `dist/index.js`. This matters for the desktop app: packaged OpenCode runs under Node and cannot strip TypeScript from plugin files located under `node_modules`.

Then reference the generated tarball from `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "file:/Users/your-user/.config/opencode/packages/opencode-lmstudio-0.3.1.tgz"
  ],
  "provider": {
    "lmstudio": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LM Studio (local)",
      "options": {
        "baseURL": "http://127.0.0.1:1234/v1",
        "apiKey": "{env:LMSTUDIO_API_KEY}"
      },
      "models": {}
    }
  }
}
```

Verify which plugin artifact OpenCode loaded:

```zsh
opencode models lmstudio --print-logs --log-level DEBUG
```

For a tarball-based local test, the logs should include a plugin path beginning with `file:` and should report the discovered model count. Published releases log the loaded plugin version on startup:

```text
[opencode-lmstudio] LM Studio plugin initialized { version: "0.3.1" }
```

After publishing the patched package to npm, switch the plugin entry to the exact released version, for example `opencode-lmstudio@0.3.1`. Avoid `opencode-lmstudio` and `opencode-lmstudio@latest` for upgrade verification because both can reuse OpenCode's stale `@latest` plugin cache.

## How It Works

1. On OpenCode startup, the plugin's `config` hook is called
2. If an `lmstudio` provider is found, it checks if LM Studio is accessible
3. If not configured, it attempts to auto-detect LM Studio on common ports
4. If accessible, it queries the `/v1/models` endpoint
5. If an API key is configured, discovery and runtime validation requests include `Authorization: Bearer <token>`
6. Embedding-only models are skipped from the chat model list
7. Discovered LLMs are merged into your configuration with OpenCode-compatible modality metadata
8. If no explicit LM Studio whitelist exists, the plugin whitelists the discovered non-embedding models so stale built-in defaults stay hidden
9. The enhanced configuration is used for the current session

## Requirements

- OpenCode with plugin support
- LM Studio running locally or on a configured network host
- LM Studio server API accessible at `http://127.0.0.1:1234/v1` or your configured `baseURL`
- Optional: `LMSTUDIO_API_KEY` or `LM_API_TOKEN` when LM Studio requires Bearer token authentication

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
