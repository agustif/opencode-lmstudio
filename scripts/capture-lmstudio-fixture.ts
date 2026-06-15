#!/usr/bin/env bun

import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { z } from "zod"
import { LMStudioModelsResponseSchema, type LMStudioModel } from "../src/types/index.ts"

const DEFAULT_URL = "http://127.0.0.1:1234"
const DEFAULT_OUTPUT = "test/fixtures/lmstudio-models.json"
const SAFE_TYPES = ["llm", "vlm", "embeddings"] as const

const LMSDownloadedModelSchema = z.looseObject({
  type: z.string().min(1),
  modelKey: z.string().min(1),
  publisher: z.string().optional(),
  format: z.string().optional(),
  architecture: z.string().optional(),
  quantization: z.object({ name: z.string().optional() }).optional(),
  vision: z.boolean().optional(),
  maxContextLength: z.number().int().positive().optional(),
})
const LMSDownloadedModelsSchema = z.array(LMSDownloadedModelSchema)

type Source = "api" | "lms"
interface Options {
  readonly all: boolean
  readonly input?: string
  readonly output: string
  readonly serverURL: string
  readonly source: Source
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function options(): Options {
  const source = optionValue("--source") ?? "api"
  if (source !== "api" && source !== "lms") throw new Error("--source must be api or lms")
  const input = optionValue("--input")
  return {
    all: process.argv.includes("--all"),
    ...(input ? { input: resolve(input) } : {}),
    output: resolve(optionValue("--output") ?? DEFAULT_OUTPUT),
    serverURL: optionValue("--url") ?? process.env.LMSTUDIO_BASE_URL ?? DEFAULT_URL,
    source,
  }
}

function modelsURL(serverURL: string): string {
  const url = new URL(serverURL)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("LM Studio fixture URL must use http or https")
  }
  url.hash = ""
  url.search = ""
  url.pathname = `${url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "")}/api/v0/models`
  return url.toString()
}

function sanitize(model: LMStudioModel): LMStudioModel {
  return {
    id: model.id,
    object: "model",
    type: model.type,
    ...(model.publisher ? { publisher: model.publisher } : {}),
    ...(model.arch ? { arch: model.arch } : {}),
    ...(model.compatibility_type ? { compatibility_type: model.compatibility_type } : {}),
    ...(model.quantization ? { quantization: model.quantization } : {}),
    ...(model.state ? { state: model.state } : {}),
    ...(model.max_context_length ? { max_context_length: model.max_context_length } : {}),
  }
}

function selectRepresentative(models: LMStudioModel[]): LMStudioModel[] {
  return SAFE_TYPES.flatMap((type) => models.find((model) => model.type === type) ?? [])
}

function mapDownloadedModels(value: unknown): LMStudioModel[] {
  const parsed = LMSDownloadedModelsSchema.safeParse(value)
  if (!parsed.success) throw new Error(`lms ls --json response failed validation: ${parsed.error.message}`)
  return parsed.data.map((model) => ({
    id: model.modelKey,
    object: "model" as const,
    type: model.type === "embedding" ? "embeddings" : model.type === "llm" && model.vision ? "vlm" : model.type,
    ...(model.publisher ? { publisher: model.publisher } : {}),
    ...(model.architecture ? { arch: model.architecture } : {}),
    ...(model.format ? { compatibility_type: model.format } : {}),
    ...(model.quantization?.name ? { quantization: model.quantization.name } : {}),
    state: "not-loaded",
    ...(model.maxContextLength ? { max_context_length: model.maxContextLength } : {}),
  }))
}

function readLMSModels(config: Options): LMStudioModel[] {
  const raw = config.input
    ? readFileSync(config.input, "utf8")
    : (() => {
        const result = spawnSync("lms", ["ls", "--json"], { encoding: "utf8" })
        if (result.error) throw result.error
        if (result.status !== 0) throw new Error(result.stderr || `lms ls --json exited ${result.status}`)
        return result.stdout
      })()
  return mapDownloadedModels(JSON.parse(raw) as unknown)
}

async function readAPIModels(config: Options): Promise<LMStudioModel[]> {
  const payload: unknown = config.input
    ? JSON.parse(readFileSync(config.input, "utf8"))
    : await (async () => {
        const apiKey = process.env.LMSTUDIO_API_KEY
        const response = await fetch(modelsURL(config.serverURL), {
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
          signal: AbortSignal.timeout(10_000),
        })
        if (!response.ok) throw new Error(`LM Studio models API returned HTTP ${response.status}`)
        return response.json() as Promise<unknown>
      })()
  const parsed = LMStudioModelsResponseSchema.safeParse(payload)
  if (!parsed.success) throw new Error(`LM Studio models API response failed validation: ${parsed.error.message}`)
  return parsed.data.data
}

const config = options()
const models = config.source === "lms" ? readLMSModels(config) : await readAPIModels(config)
const sanitized = models
  .filter((model) => SAFE_TYPES.includes(model.type as typeof SAFE_TYPES[number]))
  .map(sanitize)
  .sort((left, right) => left.type.localeCompare(right.type) || left.id.localeCompare(right.id))
const data = config.all ? sanitized : selectRepresentative(sanitized)
if (data.length === 0) throw new Error("LM Studio returned no safe fixture models")
if (!config.all && data.length !== SAFE_TYPES.length) {
  const available = new Set(data.map((model) => model.type))
  const missing = SAFE_TYPES.filter((type) => !available.has(type))
  throw new Error(`LM Studio is missing representative fixture model types: ${missing.join(", ")}`)
}

writeFileSync(config.output, `${JSON.stringify({ object: "list", data }, null, 2)}\n`)
console.log(`Wrote ${data.length} sanitized LM Studio models from ${config.source} to ${config.output}`)
