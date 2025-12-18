import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { LMStudioPlugin } from '../src/index.ts'

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
  })

  describe('Plugin Initialization', () => {
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