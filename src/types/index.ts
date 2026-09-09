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
  vision: z.boolean().optional(),
  trained_for_tool_use: z.boolean().optional(),
  reasoning: z.looseObject({
    // LM Studio can add reasoning modes without a plugin release.
    allowed_options: z.array(z.string()).optional(),
    default: z.string().optional(),
  }).optional(),
})

/** Fields required to map an LLM into an OpenCode provider model. */
export const LMStudioLLMModelSchema = z.looseObject({
  type: z.literal("llm"),
  key: z.string().min(1),
  display_name: z.string().min(1),
  publisher: z.string().min(1).optional(),
  architecture: z.string().nullable().optional(),
  quantization: z.looseObject({
    name: z.string().nullable(),
    bits_per_weight: z.number().nullable(),
  }).nullable().optional(),
  loaded_instances: z.array(LMStudioLoadedInstanceSchema),
  max_context_length: z.number().int().positive(),
  format: z.string().nullable().optional(),
  capabilities: LMStudioCapabilitiesSchema.optional(),
})

/** Non-LLM records are retained only for filtering and diagnostics. */
export const LMStudioNonLLMModelSchema = z.looseObject({
  type: z.string().min(1).refine((type) => type !== "llm"),
  key: z.string().min(1),
})

/** LM Studio's native `GET /api/v1/models` model record. */
export const LMStudioModelSchema = z.union([
  LMStudioLLMModelSchema,
  LMStudioNonLLMModelSchema,
])

export const LMStudioModelsResponseSchema = z.looseObject({
  // Individual records are validated below so one non-LLM shape cannot
  // impose LLM-only fields on the entire native response.
  models: z.array(z.any()),
})

export type LMStudioLLMModel = z.infer<typeof LMStudioLLMModelSchema>
export type LMStudioNonLLMModel = z.infer<typeof LMStudioNonLLMModelSchema>
export type LMStudioModel = LMStudioLLMModel | LMStudioNonLLMModel
export type LMStudioModelsResponse = {
  models: LMStudioModel[]
}

export type OpenCodeConfig = Parameters<NonNullable<Hooks["config"]>>[0]
export type ProviderConfig = NonNullable<OpenCodeConfig["provider"]>[string]
export type ModelConfig = NonNullable<ProviderConfig["models"]>[string]

export type LogLevel = "debug" | "info" | "warn" | "error"
export type PluginLogger = (
  level: LogLevel,
  message: string,
  extra?: Record<string, unknown>,
) => Promise<void>
