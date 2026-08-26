import type { Hooks } from "@opencode-ai/plugin"
import { z } from "zod"

/** A loaded instance reported by LM Studio's native `GET /api/v1/models`. */
export const LMStudioLoadedInstanceSchema = z.looseObject({
  id: z.string().min(1),
  config: z.looseObject({
    context_length: z.number().int().positive(),
  }),
})

/** Capabilities reported for a native v1 LLM record. */
export const LMStudioCapabilitiesSchema = z.looseObject({
  vision: z.boolean(),
  trained_for_tool_use: z.boolean(),
  reasoning: z.looseObject({
    allowed_options: z.array(z.string()),
    default: z.string(),
  }).optional(),
})

/** LM Studio's documented native `GET /api/v1/models` model record. */
export const LMStudioModelSchema = z.looseObject({
  type: z.string().min(1),
  key: z.string().min(1),
  display_name: z.string().min(1),
  publisher: z.string().min(1),
  architecture: z.string().nullable().optional(),
  quantization: z.looseObject({
    name: z.string().nullable(),
    bits_per_weight: z.number().nullable(),
  }).nullable(),
  loaded_instances: z.array(LMStudioLoadedInstanceSchema),
  max_context_length: z.number().int().positive(),
  format: z.enum(["gguf", "mlx"]).nullable(),
  capabilities: LMStudioCapabilitiesSchema.optional(),
})

export const LMStudioModelsResponseSchema = z.looseObject({
  models: z.array(LMStudioModelSchema),
})

/** A model record reported by the OpenAI-compatible `GET /v1/models` endpoint. */
export const OpenAICompatibleModelSchema = z.looseObject({
  id: z.string().min(1),
  object: z.literal("model"),
  max_tokens: z.number().int().positive().nullable().optional(),
  context_length: z.number().int().positive().nullable().optional(),
})

/** OpenAI's documented `GET /v1/models` list response. */
export const OpenAICompatibleModelsResponseSchema = z.looseObject({
  object: z.literal("list"),
  data: z.array(OpenAICompatibleModelSchema),
})

export type LMStudioModel = z.infer<typeof LMStudioModelSchema>
export type LMStudioModelsResponse = z.infer<typeof LMStudioModelsResponseSchema>
export type OpenAICompatibleModel = z.infer<typeof OpenAICompatibleModelSchema>
export type OpenAICompatibleModelsResponse = z.infer<typeof OpenAICompatibleModelsResponseSchema>

export type OpenCodeConfig = Parameters<NonNullable<Hooks["config"]>>[0]
export type ProviderConfig = NonNullable<OpenCodeConfig["provider"]>[string]
export type ModelConfig = NonNullable<ProviderConfig["models"]>[string]

export type LogLevel = "debug" | "info" | "warn" | "error"
export type PluginLogger = (
  level: LogLevel,
  message: string,
  extra?: Record<string, unknown>,
) => Promise<void>
