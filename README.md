# opencode-lmstudio

OpenCode plugin for enhanced LM Studio support with auto-detection, dynamic model discovery, and real-time model validation.

## ✨ Features

### 🔍 **Smart Model Detection**
- **Auto-detection**: Automatically detects LM Studio running on common ports (1234, 8080, 11434)
- **Dynamic Model Discovery**: Queries LM Studio's `/v1/models` endpoint to discover available models
- **Model Categorization**: Intelligently categorizes models (chat vs embedding) automatically
- **Enhanced Metadata**: Provides model capabilities and proper modalities

### ⚡ **Real-time Model Validation**
- **Pre-execution Checks**: Validates model availability before each request using OpenCode's `chat.params` hook
- **Loading State Verification**: Checks if models are actually loaded in LM Studio (not just available)
- **Error Prevention**: Prevents failed requests when models aren't ready
- **Live Monitoring**: Real-time status updates for model availability

### 🛠️ **Configuration Management**
- **Automatic Configuration**: Auto-creates `lmstudio` provider if detected but not configured
- **Smart Model Merging**: Intelligently merges discovered models with existing configuration
- **Health Check Monitoring**: Verifies LM Studio is accessible before attempting operations

### 📋 **Enhanced User Experience**
- **Clear Error Messages**: Detailed guidance when models aren't loaded
- **Step-by-step Instructions**: Helps users load models properly in LM Studio UI
- **Model Availability Display**: Shows exactly which models are ready to use
- **Troubleshooting Guidance**: Provides actionable solutions for common issues

## Installation

```bash
npm install opencode-lmstudio
# or
bun add opencode-lmstudio
```

## 🚀 Quick Start

### 1. **Auto-detection (Recommended)**

Add just the plugin to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-lmstudio@latest"
  ]
}
```

The plugin will automatically:
- ✅ Detect LM Studio running on common ports
- ✅ Create the `lmstudio` provider configuration
- ✅ Discover and categorize all available models
- ✅ Validate models are loaded before use

### 2. **Manual Configuration**

For more control, manually configure the provider:

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

### 3. **Use a Specific Model**

Set your preferred model in OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-lmstudio@latest"
  ],
  "model": "lmstudio/your-model-name"
}
```

## 🎯 What the Plugin Does

### Auto-detection Flow

1. **Startup**: Plugin initializes when OpenCode starts
2. **Discovery**: Scans common ports (1234, 8080, 11434) for LM Studio
3. **Configuration**: Auto-creates provider if detected
4. **Model Discovery**: Queries `/v1/models` endpoint
5. **Categorization**: Identifies chat vs embedding models
6. **Integration**: Merges discovered models into your configuration

### Real-time Validation

The plugin uses OpenCode's `chat.params` hook to:

- ✅ **Before Each Request**: Check if selected model is actually loaded in LM Studio
- ✅ **Provide Guidance**: Show clear steps if model needs to be loaded
- ✅ **Enhanced Logging**: Display model status and available alternatives
- ✅ **Error Prevention**: Stop requests before they fail

### Smart Model Categorization

- **Chat Models**: GPT, Llama, Claude, Qwen, Mistral, Gemma, Phi, Falcon
- **Embedding Models**: Models containing "embedding" or "embed"
- **Unknown Models**: Fallback category with basic metadata

## 🔧 Advanced Configuration

### Custom Base URL

If LM Studio runs on a different port:

```json
{
  "provider": {
    "lmstudio": {
      "options": {
        "baseURL": "http://127.0.0.1:8080/v1"
      }
    }
  }
}
```

### Model-Specific Configuration

Override settings for specific models:

```json
{
  "provider": {
    "lmstudio": {
      "options": {
        "baseURL": "http://127.0.0.1:1234/v1"
      },
      "models": {
        "llama-3.2-3b-instruct": {
          "name": "Llama 3.2 3B Instruct (local)",
          "limit": {
            "context": 8192,
            "output": 2048
          }
        }
      }
    }
  }
}
```

## 🏗️ How It Works

### Configuration Phase (Startup)
1. **Plugin Initialization**: OpenCode loads the plugin
2. **Provider Setup**: Creates or enhances `lmstudio` provider configuration  
3. **LM Studio Detection**: Scans for running LM Studio instances
4. **Model Discovery**: Queries `/v1/models` endpoint
5. **Smart Categorization**: Classifies models by type and capabilities
6. **Config Merging**: Integrates discovered models with existing settings

### Runtime Phase (During Use)
1. **Model Selection**: User selects or defaults to a model
2. **Pre-execution Hook**: `chat.params` hook validates model availability
3. **Loading Check**: Verifies model is actually loaded in LM Studio
4. **User Guidance**: Provides help if model isn't ready
5. **Request Execution**: Allows request to proceed if model is available

## 📋 Requirements

- **OpenCode** with plugin support
- **LM Studio** installed and running locally (default port: 1234)
- **Models** downloaded and loaded in LM Studio
- **Server API** accessible at `http://127.0.0.1:1234/v1`

## 🐛 Troubleshooting

### "Model not loaded in LM Studio"

**Problem**: Plugin detects model but it's not actually loaded in LM Studio
**Solution**: 
1. Open LM Studio application
2. Download the desired model if needed
3. Load the model (click "Load Model")
4. Ensure server is running

### "No models found"

**Problem**: Plugin can't discover any models
**Solution**:
1. Verify LM Studio is running
2. Check server is enabled in LM Studio settings
3. Ensure you have downloaded at least one model
4. Confirm API is accessible: `curl http://127.0.0.1:1234/v1/models`

### "LM Studio appears to be offline"

**Problem**: Can't connect to LM Studio
**Solution**:
1. Open LM Studio application
2. Go to Settings → Server
3. Enable server and verify port (default: 1234)
4. Check firewall settings

## 🎉 Examples

### Basic Usage
```bash
# Install
bun add opencode-lmstudio

# Add to opencode.json
echo '"file:///path/to/opencode-lmstudio"' >> ~/.config/opencode/opencode.json
```

### Model Selection
```json
{
  "model": "lmstudio/llama-3.2-3b-instruct"
}
```

### Development Setup
```bash
git clone https://github.com/agustif/opencode-lmstudio.git
cd opencode-lmstudio
bun install
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development
- **TypeScript**: Full type safety with `@opencode-ai/plugin`
- **Testing**: Use `bun run typecheck` for type validation
- **Hooks**: Plugin uses `config`, `event`, and `chat.params` hooks

### Areas for Improvement
- **Model Auto-loading**: Trigger model loading via LM Studio API
- **Performance**: Connection pooling and model caching
- **Monitoring**: Enhanced health check and metrics
- **UI Integration**: Better model status visualization

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🔗 Related

- [OpenCode](https://github.com/sst/opencode) - AI-powered coding assistant
- [LM Studio](https://lmstudio.ai/) - Local LLM management
- [@ai-sdk/openai-compatible](https://www.npmjs.com/package/@ai-sdk/openai-compatible) - OpenAI-compatible provider

