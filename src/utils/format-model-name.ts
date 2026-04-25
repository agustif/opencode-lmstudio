import { parse } from 'path'
import type { LMStudioModel } from '../types'

/**
 * Extract owner from model ID (e.g., "qwen" from "qwen/qwen3-30b")
 */
export function extractModelOwner(modelId: string): string | undefined {
  const parts = modelId.split('/')
  if (parts.length > 1) {
    return parts[0]
  }
  return undefined
}

/**
 * Format model name for display using available metadata
 * Creates readable titles like "Qwen3 30B A3B" instead of "qwen/qwen3-30b-a3b"
 */
export function formatModelName(model: LMStudioModel): string {
  // Extract parts from model ID
  const parts = model.id.split('/')
  let modelPart: string[];

  // Support 'google/gemma-4-e4b' , 'ollama/gemma4/gemma4-8.0b-q4_k_m.gguf'
  if (parts.length > 2) {
    modelPart = (parts.length > 2 ? parts.slice(1) : parts)
  } else {
    modelPart = parts
  }

  modelPart = modelPart
    .flatMap(part => {
      return part.split(/[-_]/)
    })
  ;

  const parsed = parse(modelPart[modelPart.length - 1])

  if (parsed.ext) {
    let m = parsed.ext.match(/^(\.\d+)([^\d].*)?$/)
    if (!m) {
      // Support 'ollama/gemma4/gemma4-8.0b-q4_k_m.gguf'
      modelPart[modelPart.length - 1] = parsed.name
      modelPart.push(parsed.ext)
    }
  }

  modelPart = modelPart
    .filter((part, index, parts) => {
      part = part.trim().toLowerCase()
      let next = parts[index + 1]?.trim().toLowerCase()

      // Support 'qwen/qwen3-30b-a3b'
      if (next?.startsWith(part)) {
        return false
      }

      return Boolean(part)
    })
  ;

  // Common acronyms that should be uppercase
  const acronyms = new Set(['gpt', 'oss', 'api', 'gguf', 'ggml', 'nomic', 'vl', 'it', 'mlx'])

  // Split by common separators and format
  const tokens = modelPart
    .map(token => {
      const lowerToken = token.toLowerCase()

      // Handle common acronyms
      if (acronyms.has(lowerToken)) {
        return token.toUpperCase()
      }

      // Handle version numbers and sizes (e.g., "30b", "3.2", "a3b", "q4", "q8")
      if (/^\d+[bkmg]$/i.test(token)) {
        return token.toUpperCase()
      }
      // Handle quantization (q4, q8, etc.)
      if (/^q\d+$/i.test(token)) {
        return token.toUpperCase()
      }
      // Handle version numbers (keep as-is)
      if (/^\d+\.\d+/.test(token)) {
        return token
      }
      // Handle special patterns like "a3b", "e4b", "3n"
      if (/^[a-z]\d+[a-z]$/i.test(token) || /^\d+[a-z]$/i.test(token)) {
        return token.toUpperCase()
      }
      // Capitalize first letter, lowercase rest
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
    })
    .join(' ')

  return tokens
}

