import { describe, it, expect } from 'vitest'
import { discoverModels, discoverOpenAIModels } from '../src/utils/lmstudio-api.ts'
import { toModelConfig, effectiveContextLength, toModelConfigFromID } from '../src/plugin/enhance-config.ts'

const SERVER = 'http://192.168.50.241:1234'

describe('live: native endpoint', () => {
  it('discovers LLMs with context_length metadata', async () => {
    const response = await discoverModels(SERVER)
    const llms = response.models.filter((m): m is typeof m & { type: 'llm' } => m.type === 'llm')
    expect(llms.length).toBeGreaterThan(0)

    for (const model of llms) {
      const ctx = effectiveContextLength(model)
      const cfg = toModelConfig(model)

      // context should be derived from loaded_instances or max_context_length
      expect(ctx).toBeGreaterThan(0)

      // config should have valid limits
      expect(cfg.limit?.context).toBe(ctx)
      expect(cfg.limit?.output).toBeGreaterThan(0)
      expect(cfg.limit?.output).toBeLessThanOrEqual(cfg.limit?.context ?? 0)

      // tool_call should be true for models with trained_for_tool_use
      if (model.capabilities?.trained_for_tool_use) {
        expect(cfg.tool_call).toBe(true)
      }

      console.log(`  ${model.display_name}: context=${ctx}, output=${cfg.limit?.output}, tool_call=${cfg.tool_call}`)
    }
  }, 15000)
})

describe('live: OpenAI-compatible fallback', () => {
  it('discovers models without metadata fields', async () => {
    const models = await discoverOpenAIModels(SERVER)
    expect(models.length).toBeGreaterThan(0)

    for (const m of models) {
      expect(m.id).toBeTruthy()
      // OpenAI endpoint doesn't return max_tokens/context_length
      // So these should be undefined and fall back to DEFAULT_OPENAI_CONTEXT
      const cfg = toModelConfigFromID(m)
      // Should fall back to 32768 when no metadata available
      expect(cfg.limit?.context).toBe(32768)
      console.log(`  ${m.id}: context=${cfg.limit?.context}, maxTokens=${m.maxTokens}, contextLength=${m.contextLength}`)
    }
  }, 15000)
})
