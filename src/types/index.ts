import { z } from "zod"
import type { Hooks } from "@opencode-ai/plugin"

/** LM Studio's documented typed `GET /api/v0/models` response. */
export const LMStudioModelSchema = z.looseObject({
  id: z.string().min(1),
  object: z.literal("model").optional(),
  type: z.string().min(1),
  publisher: z.string().optional(),
  arch: z.string().optional(),
  compatibility_type: z.string().optional(),
  quantization: z.string().optional(),
  state: z.string().optional(),
  max_context_length: z.number().int().positive().optional(),
})

export const LMStudioModelsResponseSchema = z.looseObject({
  object: z.literal("list").optional(),
  data: z.array(LMStudioModelSchema),
})

export type LMStudioModel = z.infer<typeof LMStudioModelSchema>
export type LMStudioModelsResponse = z.infer<typeof LMStudioModelsResponseSchema>

export type OpenCodeConfig = Parameters<NonNullable<Hooks["config"]>>[0]
export type ProviderConfig = NonNullable<OpenCodeConfig["provider"]>[string]
export type ModelConfig = NonNullable<ProviderConfig["models"]>[string]

export type LogLevel = "debug" | "info" | "warn" | "error"
export type PluginLogger = (
  level: LogLevel,
  message: string,
  extra?: Record<string, unknown>,
) => Promise<void>
