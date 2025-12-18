# API Reference

## Plugin Hooks

The opencode-lmstudio plugin uses the following OpenCode hooks:

### `config` Hook
**Type**: `(config: Config) => Promise<void>`  
**When**: During OpenCode startup  
**Purpose**: Auto-detects LM Studio and enhances configuration

**What it does**:
- Scans for LM Studio on common ports (1234, 8080, 11434)
- Creates `lmstudio` provider if not configured
- Discovers and categorizes available models
- Merges discovered models with existing configuration

### `event` Hook
**Type**: `({ event: Event }) => Promise<void>`  
**When**: For all system events  
**Purpose**: Monitors session events for future enhancements

**Events monitored**:
- `session.created` - New session created
- `session.updated` - Session updated

### `chat.params` Hook
**Type**: `(input: ChatParamsInput, output: ChatParamsOutput) => Promise<void>`  
**When**: Right before model execution  
**Purpose**: Real-time model validation and preloading

**Input structure**:
```typescript
{
  sessionID: string,
  agent: string,
  model: Model,
  provider: ProviderContext,
  message: UserMessage
}
```

**Output structure**:
```typescript
{
  temperature: number,
  topP: number,
  topK: number,
  options: Record<string, any>
}
```

**What it does**:
- Validates if selected model is loaded in LM Studio
- Provides helpful error messages if model isn't ready
- Sets `lmstudioReady` or `lmstudioNotLoaded` in options

## Model Discovery

### Model Categorization

Models are automatically categorized by ID patterns:

#### Chat Models
```typescript
const chatPatterns = [
  'gpt', 'llama', 'claude', 'qwen', 
  'mistral', 'gemma', 'phi', 'falcon'
]
```

#### Embedding Models
```typescript
const embeddingPatterns = ['embedding', 'embed']
```

### Model Configuration

Discovered models get this configuration:

```typescript
{
  id: string,           // Original model ID from LM Studio
  name: string,         // Display name with "(LM Studio)" suffix
  modalities?: {        // Based on categorization
    input: string[],
    output: string[]
  }
}
```

## Error Handling

### Error Types

#### Connection Errors
- **Message**: "LM Studio appears to be offline"
- **Solution**: Check LM Studio is running and server is enabled

#### No Models Found
- **Message**: "No models found in LM Studio"
- **Solution**: Download and load models in LM Studio

#### Model Not Loaded
- **Message**: "Model not loaded in LM Studio"
- **Solution**: Load model in LM Studio UI

#### Only Embedding Models
- **Message**: "Only embedding models found"
- **Solution**: Download chat models for text generation

## Logging

All operations include structured logging:

```typescript
log.info("Message", { data: object })
log.warn("Warning", { data: object })
```

### Log Categories

- Plugin initialization
- LM Studio detection
- Model discovery
- Model validation
- Error conditions
- User guidance

## Configuration Options

### Base URL
Default: `http://127.0.0.1:1234`  
Override in provider options:

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

### Timeouts
- Model discovery: 2000ms
- Health checks: 2000ms
- Model loading checks: 2000ms

### Ports Scanned
- Primary: 1234 (LM Studio default)
- Secondary: 8080, 11434 (alternative ports)

## Development

### Project Structure
```
src/
├── index.ts          # Main plugin implementation
└── types.ts          # TypeScript type definitions
```

### Build Commands
```bash
bun install          # Install dependencies
bun run typecheck    # Type checking
```

### Testing
```bash
# Test plugin functionality
bun test/index.ts

# Test model discovery
curl http://127.0.0.1:1234/v1/models
```

## Contributing

When adding features:

1. **Type Safety**: Use `@opencode-ai/plugin` types
2. **Error Handling**: Provide clear user guidance
3. **Logging**: Include structured data for debugging
4. **Backwards Compatibility**: Maintain existing config formats
5. **Performance**: Use timeouts and connection pooling