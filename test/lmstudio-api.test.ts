import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverLMStudioModels } from '../src/utils/lmstudio-api.ts'

const mockFetch = vi.fn()
global.fetch = mockFetch

if (!global.AbortSignal.timeout) {
  global.AbortSignal.timeout = vi.fn(() => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 3000)
    return controller.signal
  })
}

describe('discoverLMStudioModels', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mockFetch.mockReset()
  })

  it('prefers LM Studio api/v1 metadata when available', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [
          {
            key: 'qwen3.6-35b-a3b',
            display_name: 'Qwen3.6 35B A3B UD',
            type: 'vlm',
            publisher: 'unsloth',
            architecture: 'qwen35moe',
            format: 'gguf',
            max_context_length: 262144,
            capabilities: {
              vision: true,
              trained_for_tool_use: true,
            },
            loaded_instances: [
              {
                id: 'qwen3.6-35b-a3b',
                config: {
                  context_length: 131072,
                },
              },
            ],
          },
        ],
      }),
    })

    const models = await discoverLMStudioModels()

    expect(models).toEqual([
      expect.objectContaining({
        id: 'qwen3.6-35b-a3b',
        display_name: 'Qwen3.6 35B A3B UD',
        type: 'vlm',
        publisher: 'unsloth',
        arch: 'qwen35moe',
        compatibility_type: 'gguf',
        max_context_length: 262144,
        loaded_context_length: 131072,
      }),
    ])

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0]?.[0]).toContain('/api/v1/models')
  })

  it('falls back to api/v0 and then openai-compatible models', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          object: 'list',
          data: [
            {
              id: 'fallback-model',
              object: 'model',
              type: 'llm',
              max_context_length: 8192,
            },
          ],
        }),
      })

    const models = await discoverLMStudioModels()

    expect(models).toEqual([
      expect.objectContaining({
        id: 'fallback-model',
        max_context_length: 8192,
      }),
    ])
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch.mock.calls[1]?.[0]).toContain('/api/v0/models')
  })

  it('falls back to /v1/models when richer endpoints are unavailable', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
      })
      .mockResolvedValueOnce({
        ok: false,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          object: 'list',
          data: [
            {
              id: 'openai-compatible-model',
              object: 'model',
              owned_by: 'organization_owner',
            },
          ],
        }),
      })

    const models = await discoverLMStudioModels()

    expect(models).toEqual([
      expect.objectContaining({
        id: 'openai-compatible-model',
      }),
    ])
    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(mockFetch.mock.calls[2]?.[0]).toContain('/v1/models')
  })
})
