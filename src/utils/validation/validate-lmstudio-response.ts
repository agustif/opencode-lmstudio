import type { ValidationResult } from './validation-result.ts'

export function validateLMStudioResponse(data: any): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!data || typeof data !== 'object') {
    errors.push('LM Studio response must be an object')
    return { isValid: false, errors, warnings }
  }

  if (data.data && Array.isArray(data.data)) {
    data.data.forEach((model: any, index: number) => {
      if (!model.id || typeof model.id !== 'string') {
        errors.push(`Model at index ${index} missing required id field`)
      }
      if (!model.object || typeof model.object !== 'string') {
        warnings.push(`Model at index ${index} missing object field`)
      }
    })
  } else {
    warnings.push('LM Studio response missing data array or data is not an array')
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  }
}
