# opencode-lmstudio

OpenCode plugin for enhanced LM Studio support with auto-detection and dynamic model discovery.

## Features

- **Auto-detection**: Automatically detects LM Studio running on common ports (1234, 8080, 11434)
- **Dynamic Model Discovery**: Queries LM Studio's `/api/v0/models` endpoint (fallback: `/v1/models`) to discover available models
- **Context Length Discovery**: Reads `loaded_context_length` / `max_context_length` from LM Studio and exposes them as `limit.context`, enabling OpenCode features like auto-compaction
- **Smart Model Formatting**: Automatically formats model names for better readability (e.g., "Qwen3 30B A3B" instead of "qwen/qwen3-30b-a3b")
- **Organization Owner Extraction**: Extracts and sets `organizationOwner` field from model IDs
- **Health Check Monitoring**: Verifies LM Studio is accessible before attempting operations
- **Automatic Configuration**: Auto-creates `lmstudio` provider if detected but not configured
- **Model Merging**: Intelligently merges discovered models with existing configuration
- **Comprehensive Caching**: Reduces API calls with intelligent caching system
- **Error Handling**: Smart error categorization with auto-fix suggestions

## Installation

```bash
npm install opencode-lmstudio
# or
bun add opencode-lmstudio
```

## Usage

Add the plugin to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-lmstudio@latest"
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

### Manual Configuration

You can also manually configure the provider with specific models:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-lmstudio@latest"
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

## How It Works

1. On OpenCode startup, the plugin's `config` hook is called
2. If an `lmstudio` provider is found, it checks if LM Studio is accessible
3. If not configured, it attempts to auto-detect LM Studio on common ports
4. If accessible, it queries `/api/v0/models` for rich metadata (context length, model type, publisher), falling back to `/v1/models` on older LM Studio versions (< 0.3.5)
5. Discovered models are merged into your configuration, including `limit.context` when available — this lets OpenCode enable auto-compaction based on the context window actually configured in LM Studio
6. The enhanced configuration is used for the current session

## Requirements

- OpenCode with plugin support
- LM Studio running locally (default port: 1234)
- LM Studio server API accessible at `http://127.0.0.1:1234/v1`

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

