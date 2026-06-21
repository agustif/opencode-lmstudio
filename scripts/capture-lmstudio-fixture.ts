#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { LMStudioModelsResponseSchema, type LMStudioModel } from "../src/types/index.ts"
import { DEFAULT_LM_STUDIO_URL, discoverModels, getLMStudioApiKey } from "../src/utils/lmstudio-api.ts"

const DEFAULT_OUTPUT = "test/fixtures/lmstudio-models.json"

interface Options {
  readonly all: boolean
  readonly input?: string
  readonly lmStudioVersion: string
  readonly output: string
  readonly serverURL: string
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function options(): Options {
  const input = optionValue("--input")
  const lmStudioVersion = optionValue("--lm-studio-version")
  if (!lmStudioVersion) throw new Error("--lm-studio-version is required for fixture provenance")
  return {
    all: process.argv.includes("--all"),
    ...(input ? { input: resolve(input) } : {}),
    lmStudioVersion,
    output: resolve(optionValue("--output") ?? DEFAULT_OUTPUT),
    serverURL: optionValue("--url") ?? process.env.LMSTUDIO_BASE_URL ?? DEFAULT_LM_STUDIO_URL,
  }
}

function sanitize(model: LMStudioModel): LMStudioModel {
  return {
    type: model.type,
    key: model.key,
    display_name: model.display_name,
    publisher: model.publisher,
    ...(model.architecture !== undefined ? { architecture: model.architecture } : {}),
    quantization: model.quantization,
    loaded_instances: model.loaded_instances.map((instance) => ({
      id: instance.id,
      config: { context_length: instance.config.context_length },
    })),
    max_context_length: model.max_context_length,
    format: model.format,
    ...(model.capabilities ? {
      capabilities: {
        vision: model.capabilities.vision,
        trained_for_tool_use: model.capabilities.trained_for_tool_use,
        ...(model.capabilities.reasoning ? { reasoning: model.capabilities.reasoning } : {}),
      },
    } : {}),
  }
}

function selectRepresentative(models: LMStudioModel[]): LMStudioModel[] {
  const text = models.find((model) => model.type === "llm" && model.capabilities?.vision !== true)
  const vision = models.find((model) => model.type === "llm" && model.capabilities?.vision === true)
  const embedding = models.find((model) => model.type === "embedding")
  const selected = [text, vision, embedding].filter((model): model is LMStudioModel => model !== undefined)
  if (selected.length !== 3) {
    throw new Error("LM Studio must provide representative text, vision, and embedding models")
  }
  return selected
}

async function readModels(config: Options): Promise<LMStudioModel[]> {
  if (config.input) {
    const raw: unknown = JSON.parse(readFileSync(config.input, "utf8"))
    const parsed = LMStudioModelsResponseSchema.safeParse(raw)
    if (!parsed.success) throw new Error(`LM Studio fixture input failed validation: ${parsed.error.message}`)
    return parsed.data.models
  }
  const apiKey = getLMStudioApiKey(undefined, config.serverURL)
  return (await discoverModels(config.serverURL, { apiKey, timeoutMs: 10_000 })).models
}

const config = options()
const sanitized = (await readModels(config))
  .filter((model) => model.type === "llm" || model.type === "embedding")
  .map(sanitize)
  .sort((left, right) => left.type.localeCompare(right.type) || left.key.localeCompare(right.key))
const models = config.all ? sanitized : selectRepresentative(sanitized)
if (models.length === 0) throw new Error("LM Studio returned no safe fixture models")

const fixture = {
  _fixture: {
    schema: "lm-studio-native-api-v1",
    source: config.input ? "sanitized input" : "sanitized local capture",
    lm_studio_version: config.lmStudioVersion,
    captured_at: new Date().toISOString().slice(0, 10),
  },
  models,
}
writeFileSync(config.output, `${JSON.stringify(fixture, null, 2)}\n`)
console.log(`Wrote ${models.length} sanitized native v1 models to ${config.output}`)
