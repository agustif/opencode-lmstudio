import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { LMStudioPlugin } from '../src/index.ts'
import { discoverLMStudioModels, getLMStudioApiKey } from '../src/utils/lmstudio-api.ts'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock AbortSignal.timeout for older Node versions
if (!global.AbortSignal.timeout) {
  global.AbortSignal.timeout = vi.fn(() => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 3000)
    return controller.signal
  })
}

describe('LMStudio Plugin', () => {
  let mockClient: any
  let pluginHooks: any

  beforeEach(async () => {
    // Reset fetch mock
    mockFetch.mockClear()
    
    // Mock client
    mockClient = {
      tui: {
        showToast: vi.fn().mockResolvedValue(true)
      }
    }
    
    // Mock minimal PluginInput - just cast to any for simplicity in tests
    const mockInput: any = {
      client: mockClient,
      project: { 
        id: 'test-project',
        name: 'test', 
        path: '/tmp',
        worktree: '',
        time: { created: Date.now() }
      },
      directory: '/tmp',
      worktree: '',
      $: vi.fn()
    }
    
    pluginHooks = await LMStudioPlugin(mockInput)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.LMSTUDIO_API_KEY
    delete process.env.LM_API_TOKEN
    delete process.env.CUSTOM_LM_STUDIO_KEY
  })

  describe('LM Studio API Authentication', () => {
    it('should resolve api keys from OpenCode env syntax', () => {
      process.env.CUSTOM_LM_STUDIO_KEY = 'test-token'

      expect(getLMStudioApiKey('{env:CUSTOM_LM_STUDIO_KEY}')).toBe('test-token')
    })

    it('should fall back to LM Studio-specific environment variables', () => {
      process.env.LM_API_TOKEN = 'legacy-token'
      process.env.LMSTUDIO_API_KEY = 'preferred-token'

      expect(getLMStudioApiKey()).toBe('preferred-token')
    })

    it('should only use environment fallback for local or private LM Studio URLs', () => {
      process.env.LMSTUDIO_API_KEY = 'private-token'

      expect(getLMStudioApiKey(undefined, 'http://127.0.0.1:1234/v1')).toBe('private-token')
      expect(getLMStudioApiKey(undefined, 'http://192.168.0.10:1234/v1')).toBe('private-token')
      expect(getLMStudioApiKey(undefined, 'http://[::1]:1234/v1')).toBe('private-token')
      expect(getLMStudioApiKey(undefined, 'http://[fc00::1]:1234/v1')).toBe('private-token')
      expect(getLMStudioApiKey(undefined, 'http://[fd00::1]:1234/v1')).toBe('private-token')
      expect(getLMStudioApiKey(undefined, 'http://[fe80::1]:1234/v1')).toBe('private-token')
      expect(getLMStudioApiKey(undefined, 'http://[febf::1]:1234/v1')).toBe('private-token')
      expect(getLMStudioApiKey(undefined, 'https://example.com/v1')).toBeUndefined()
      expect(getLMStudioApiKey(undefined, 'https://fcorp.example/v1')).toBeUndefined()
      expect(getLMStudioApiKey(undefined, 'https://fdservice.example/v1')).toBeUndefined()
      expect(getLMStudioApiKey(undefined, 'https://fe80-models.example/v1')).toBeUndefined()
      expect(getLMStudioApiKey(undefined, 'http://[fec0::1]:1234/v1')).toBeUndefined()
    })

    it('should allow explicitly configured env syntax for non-private URLs', () => {
      process.env.CUSTOM_LM_STUDIO_KEY = 'explicit-token'

      expect(getLMStudioApiKey('{env:CUSTOM_LM_STUDIO_KEY}', 'https://example.com/v1')).toBe('explicit-token')
    })

    it('should send bearer auth headers during model discovery', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'auth-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      await discoverLMStudioModels('http://127.0.0.1:1234/v1', 'explicit-token')

      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:1234/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer explicit-token'
          })
        })
      )
    })

    it('should not send environment fallback auth headers to public URLs', async () => {
      process.env.LMSTUDIO_API_KEY = 'private-token'
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'public-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      await discoverLMStudioModels('https://example.com/v1')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/v1/models',
        expect.objectContaining({
          headers: expect.not.objectContaining({
            Authorization: expect.any(String)
          })
        })
      )
    })
  })

  describe('Plugin Initialization', () => {
    it('should log the package version during initialization', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const mockInput: any = {
        client: mockClient,
        project: {
          id: 'test-project',
          name: 'test',
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }

      await LMStudioPlugin(mockInput)

      expect(consoleSpy).toHaveBeenCalledWith(
        '[opencode-lmstudio] LM Studio plugin initialized',
        expect.objectContaining({
          version: expect.any(String)
        })
      )
    })

    it('should initialize successfully with valid client', async () => {
      const mockInput: any = {
        client: mockClient,
        project: { 
          id: 'test-project',
          name: 'test', 
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }
      const hooks = await LMStudioPlugin(mockInput)
      expect(hooks).toBeDefined()
      expect(hooks.config).toBeTypeOf('function')
      expect(hooks.event).toBeTypeOf('function')
      expect(hooks['chat.params']).toBeTypeOf('function')
    })

    it('should handle invalid client gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const mockInput: any = {
        client: null,
        project: { 
          id: 'test-project',
          name: 'test', 
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }
      const hooks = await LMStudioPlugin(mockInput)
      
      expect(hooks.config).toBeTypeOf('function')
      expect(hooks.event).toBeTypeOf('function')
      expect(hooks['chat.params']).toBeTypeOf('function')
      expect(consoleSpy).toHaveBeenCalledWith('[opencode-lmstudio] Invalid client provided to plugin')
      
      consoleSpy.mockRestore()
    })
  })

  describe('Config Hook', () => {
    it('should validate config and reject invalid configurations', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      
      await pluginHooks.config(null)
      expect(consoleSpy).toHaveBeenCalledWith('[opencode-lmstudio] Invalid config provided:', expect.arrayContaining(['Config must be an object']))
      
      consoleSpy.mockRestore()
    })

    it('should handle empty config gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      
      await pluginHooks.config({})
      // Should not throw error
      expect(true).toBe(true)
      
      consoleSpy.mockRestore()
    })

    it('should auto-detect LM Studio when not configured', async () => {
      // Mock successful health check on default port
      mockFetch.mockResolvedValueOnce({
        ok: true
      })

      // Mock models response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'test-model-1', object: 'model', created: 1234567890, owned_by: 'local' },
            { id: 'test-model-2', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const config: any = {}
      await pluginHooks.config(config)

      expect(config.provider?.lmstudio).toBeDefined()
      expect(config.provider?.lmstudio?.npm).toBe('@ai-sdk/openai-compatible')
      expect(config.provider?.lmstudio?.options?.baseURL).toBe('http://127.0.0.1:1234/v1')
    })

    it('should merge discovered models with existing config', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'new-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const config: any = {
        provider: {
          lmstudio: {
            npm: '@ai-sdk/openai-compatible',
            name: 'LM Studio (local)',
            options: { baseURL: 'http://127.0.0.1:1234/v1' },
            models: {
              'existing-model': { name: 'Existing Model' }
            }
          }
        }
      }

      await pluginHooks.config(config)

      expect(config.provider.lmstudio.models).toEqual({
        'existing-model': { name: 'Existing Model' },
        'new-model': expect.objectContaining({
          id: 'new-model',
          name: 'New Model'
        })
      })
    })

    it('should generate the whitelist from discovered models instead of stale defaults', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'qwen/qwen3-coder-next', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const config: any = {
        provider: {
          lmstudio: {
            npm: '@ai-sdk/openai-compatible',
            name: 'LM Studio (local)',
            options: { baseURL: 'http://127.0.0.1:1234/v1' },
            models: {
              'gpt-oss-20b': { name: 'GPT OSS 20B' },
              'qwen3-30b-a3b-2507': { name: 'Qwen3 30B A3B 2507' }
            }
          }
        }
      }

      await pluginHooks.config(config)

      expect(config.provider.lmstudio.models).toEqual(expect.objectContaining({
        'gpt-oss-20b': { name: 'GPT OSS 20B' },
        'qwen3-30b-a3b-2507': { name: 'Qwen3 30B A3B 2507' },
        'qwen_qwen3-coder-next': expect.objectContaining({
          id: 'qwen/qwen3-coder-next',
          name: 'Qwen3 Coder Next'
        })
      }))
      expect(config.provider.lmstudio.whitelist).toEqual([
        'qwen_qwen3-coder-next',
        'qwen/qwen3-coder-next'
      ])
      expect(config.provider.lmstudio.whitelist).not.toContain('gpt-oss-20b')
      expect(config.provider.lmstudio.whitelist).not.toContain('qwen3-30b-a3b-2507')
    })

    it('should skip embedding models and mark discovered LLM modalities', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'text-embedding-nomic-embed-text-v1.5', object: 'model', created: 1234567890, owned_by: 'local' },
            { id: 'qwen/qwen3-coder-30b', object: 'model', created: 1234567890, owned_by: 'local' },
            { id: 'gemma-4-12b-it', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const config: any = {
        provider: {
          lmstudio: {
            npm: '@ai-sdk/openai-compatible',
            name: 'LM Studio (local)',
            options: { baseURL: 'http://127.0.0.1:1234/v1' },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(config.provider.lmstudio.models).not.toHaveProperty('text-embedding-nomic-embed-text-v1_5')
      expect(config.provider.lmstudio.whitelist).not.toContain('text-embedding-nomic-embed-text-v1_5')
      expect(config.provider.lmstudio.whitelist).not.toContain('text-embedding-nomic-embed-text-v1.5')
      expect(config.provider.lmstudio.whitelist).toEqual(expect.arrayContaining([
        'qwen_qwen3-coder-30b',
        'qwen/qwen3-coder-30b',
        'gemma-4-12b-it'
      ]))
      expect(config.provider.lmstudio.models['qwen_qwen3-coder-30b']).toEqual(expect.objectContaining({
        id: 'qwen/qwen3-coder-30b',
        modalities: {
          input: ['text'],
          output: ['text']
        }
      }))
      expect(config.provider.lmstudio.models['gemma-4-12b-it']).toEqual(expect.objectContaining({
        id: 'gemma-4-12b-it',
        modalities: {
          input: ['text', 'image'],
          output: ['text']
        }
      }))
      expect(consoleSpy).toHaveBeenCalledWith('[opencode-lmstudio] Skipped embedding models', { count: 1 })

      consoleSpy.mockRestore()
    })

    it('should preserve an explicit LM Studio model whitelist', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'qwen/qwen3-coder-30b', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const config: any = {
        provider: {
          lmstudio: {
            npm: '@ai-sdk/openai-compatible',
            name: 'LM Studio (local)',
            options: { baseURL: 'http://127.0.0.1:1234/v1' },
            whitelist: ['existing-model'],
            models: {
              'existing-model': { name: 'Existing Model' }
            }
          }
        }
      }

      await pluginHooks.config(config)

      expect(config.provider.lmstudio.whitelist).toEqual(['existing-model'])
      expect(config.provider.lmstudio.models['qwen_qwen3-coder-30b']).toEqual(expect.objectContaining({
        id: 'qwen/qwen3-coder-30b'
      }))
    })

    it('should handle LM Studio offline gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'))

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const config: any = {
        provider: {
          lmstudio: {
            npm: '@ai-sdk/openai-compatible',
            name: 'LM Studio (local)',
            options: { baseURL: 'http://127.0.0.1:1234/v1' }
          }
        }
      }

      await pluginHooks.config(config)

      expect(consoleSpy).toHaveBeenCalledWith('[opencode-lmstudio] LM Studio appears to be offline', expect.objectContaining({ baseURL: 'http://127.0.0.1:1234' }))
      
      consoleSpy.mockRestore()
    })
  })

  describe('Event Hook', () => {
    it('should validate event input', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      
      await pluginHooks.event({ event: null })
      expect(consoleSpy).toHaveBeenCalledWith('[opencode-lmstudio] Invalid event input:', expect.arrayContaining(['event: event is required and must be an object']))
      
      consoleSpy.mockRestore()
    })

    it('should handle session events gracefully', async () => {
      await pluginHooks.event({ event: { type: 'session.created' } })
      // Should not throw error
      expect(true).toBe(true)
    })
  })

  describe('Chat Params Hook', () => {
    it('should validate chat params input', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const output: any = {}
      
      await pluginHooks['chat.params'](null, output)
      expect(consoleSpy).toHaveBeenCalledWith('[opencode-lmstudio] Invalid chat.params input')
      
      consoleSpy.mockRestore()
    })

    it('should skip non-LM Studio providers', async () => {
      const input = {
        model: { id: 'test-model' },
        provider: { info: { id: 'anthropic' } }
      }
      const output: any = {}
      
      await pluginHooks['chat.params'](input, output)
      expect(output).toEqual({})
      expect(mockClient.tui.showToast).not.toHaveBeenCalled()
    })

    it('should validate LM Studio model availability', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'test-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const input = {
        sessionID: 'test-session',
        model: { id: 'test-model' },
        provider: { 
          info: { id: 'lmstudio' },
          options: { baseURL: 'http://127.0.0.1:1234/v1' }
        }
      }
      const output: any = {}

      await pluginHooks['chat.params'](input, output)

      expect(mockClient.tui.showToast).toHaveBeenCalledWith(expect.objectContaining({
        body: expect.objectContaining({
          variant: 'success',
          message: 'Model \'test-model\' is ready to use'
        })
      }))
      expect(output.options?.lmstudioValidation).toEqual(expect.objectContaining({
        status: 'success',
        model: 'test-model'
      }))
    })

    it('should send configured apiKey when validating LM Studio model availability', async () => {
      process.env.CUSTOM_LM_STUDIO_KEY = 'runtime-token'
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'auth-runtime-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const input = {
        sessionID: 'test-session',
        model: { id: 'auth-runtime-model' },
        provider: {
          info: { id: 'lmstudio' },
          options: {
            baseURL: 'http://127.0.0.1:4321/v1',
            apiKey: '{env:CUSTOM_LM_STUDIO_KEY}'
          }
        }
      }
      const output: any = {}

      await pluginHooks['chat.params'](input, output)

      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:4321/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer runtime-token'
          })
        })
      )
      expect(output.options?.lmstudioValidation).toEqual(expect.objectContaining({
        status: 'success',
        model: 'auth-runtime-model'
      }))
    })

    it('should handle model not loaded', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [] // No models loaded initially
        })
      })

      const input = {
        sessionID: 'test-session',
        model: { id: 'missing-model' },
        provider: { 
          info: { id: 'lmstudio' },
          options: { baseURL: 'http://127.0.0.1:1234/v1' }
        }
      }
      const output: any = {}

      await pluginHooks['chat.params'](input, output)

      expect(mockClient.tui.showToast).toHaveBeenCalledWith(expect.objectContaining({
        body: expect.objectContaining({
          variant: 'error',
          message: expect.stringContaining('not ready')
        })
      }))
      expect(output.options?.lmstudioValidation).toEqual(expect.objectContaining({
        status: 'error',
        model: 'missing-model'
      }))
    })

    it('should handle network errors gracefully', async () => {
      // Mock network error for fresh calls
      mockFetch.mockRejectedValueOnce(new Error('Network error'))
      mockFetch.mockRejectedValueOnce(new Error('Network error'))
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const input = {
        sessionID: 'test-session',
        model: { id: 'test-model-failing' }, // Use different model to bypass cache
        provider: { 
          info: { id: 'lmstudio' },
          options: { baseURL: 'http://127.0.0.1:1234/v1' }
        }
      }
      const output: any = {}

      await pluginHooks['chat.params'](input, output)

      expect(output.options?.lmstudioValidation).toEqual(expect.objectContaining({
        status: 'error',
        errorCategory: expect.any(String)
      }))
    })
  })

  describe('Error Handling', () => {
    it('should handle toast notification errors gracefully', async () => {
      mockClient.tui.showToast.mockRejectedValue(new Error('Toast failed'))
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] })
      })

      const input = {
        model: { id: 'test-model' },
        provider: { info: { id: 'lmstudio' } }
      }
      const output: any = {}

      await pluginHooks['chat.params'](input, output)

      expect(consoleSpy).toHaveBeenCalledWith('[opencode-lmstudio] Failed to show progress toast', expect.any(Error))
      
      consoleSpy.mockRestore()
    })

    it('should handle config enhancement errors', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Mock fetch to throw error during auto-detection
      mockFetch.mockRejectedValue(new Error('Auto-detection failed'))

      const config: any = {}
      await pluginHooks.config(config)

      // Should handle error gracefully without throwing
      expect(true).toBe(true)
      
      consoleSpy.mockRestore()
    })
  })
})
