import type { ValidationResult } from './validation-result'

const allowedModelTypes = new Set(['chat', 'embedding', 'unknown'])
const allowedModelTypesList = Array.from(allowedModelTypes).join(', ')

function formatInvalidModelTypeError(modelType: unknown): string {
  const value = String(modelType)
  const suggestion = value === 'embedded' ? ' Did you mean "embedding"?' : ''
  return `LM Studio provider options.modelTypes contains invalid value: ${value}. Allowed values: ${allowedModelTypesList}.${suggestion}`
}

function validateModelTypesOption(
  errors: string[],
  modelTypes: unknown,
  optionPath: string
): void {
  if (!Array.isArray(modelTypes)) {
    errors.push(`LM Studio provider ${optionPath} must be an array`)
    return
  }

  for (const modelType of modelTypes) {
    if (typeof modelType !== 'string' || !allowedModelTypes.has(modelType)) {
      errors.push(formatInvalidModelTypeError(modelType))
    }
  }
}

export function validateConfig(config: any): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!config || typeof config !== 'object') {
    errors.push('Config must be an object')
    return { isValid: false, errors, warnings }
  }

  // Validate provider configuration
  if (config.provider && typeof config.provider === 'object') {
    const lmstudio = config.provider.lmstudio
    if (lmstudio) {
      // Auto-fix missing required fields instead of failing
      if (!lmstudio.npm) {
        lmstudio.npm = "@ai-sdk/openai-compatible"
        warnings.push('LM Studio provider missing npm field, auto-set to @ai-sdk/openai-compatible')
      }
      if (!lmstudio.name) {
        lmstudio.name = "LM Studio (local)"
        warnings.push('LM Studio provider missing name field, auto-set to "LM Studio (local)"')
      }
      if (!lmstudio.options) {
        lmstudio.options = {}
        warnings.push('LM Studio provider missing options field, auto-created empty options')
      } else {
        // Validate options
        if (!lmstudio.options.baseURL) {
          warnings.push('LM Studio provider missing baseURL, will use default')
        } else if (typeof lmstudio.options.baseURL !== 'string') {
          errors.push('LM Studio provider baseURL must be a string')
        } else if (!isValidURL(lmstudio.options.baseURL)) {
          warnings.push('LM Studio provider baseURL may be invalid')
        }

        if (lmstudio.options.modelTypes !== undefined) {
          validateModelTypesOption(errors, lmstudio.options.modelTypes, 'options.modelTypes')
        } else if (lmstudio.options.model_types !== undefined) {
          validateModelTypesOption(errors, lmstudio.options.model_types, 'options.model_types')
        }
      }

      // Validate models configuration
      if (lmstudio.models && typeof lmstudio.models !== 'object') {
        errors.push('LM Studio provider models must be an object')
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  }
}

function isValidURL(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}
