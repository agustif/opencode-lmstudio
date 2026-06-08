import type { ValidationResult } from './validation-result.ts'

export function safeJSONParse<T>(json: string, validator?: (data: any) => ValidationResult): { data?: T; error?: string; validation?: ValidationResult } {
  try {
    const parsed = JSON.parse(json)
    
    if (validator) {
      const validation = validator(parsed)
      if (!validation.isValid) {
        return { error: 'Validation failed', validation }
      }
      return { data: parsed as T, validation }
    }
    
    return { data: parsed as T }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export async function safeAsyncOperation<T>(
  operation: () => Promise<T>,
  fallbackValue?: T,
  errorHandler?: (error: Error) => void
): Promise<{ data?: T; error?: string }> {
  try {
    const data = await operation()
    return { data }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    if (errorHandler) {
      errorHandler(error instanceof Error ? error : new Error(errorMessage))
    }
    if (fallbackValue !== undefined) {
      return { data: fallbackValue }
    }
    return { error: errorMessage }
  }
}
