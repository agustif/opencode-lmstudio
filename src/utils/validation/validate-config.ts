import type { ValidationResult } from './validation-result.ts'

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
