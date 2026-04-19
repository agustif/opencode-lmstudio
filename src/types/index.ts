// Core types for LM Studio plugin
export interface LMStudioModel {
  id: string
  object: string
  created?: number
  owned_by?: string
  display_name?: string
  type?: string
  publisher?: string
  arch?: string
  compatibility_type?: string
  max_context_length?: number
  loaded_context_length?: number
  capabilities?: string[] | {
    vision?: boolean
    trained_for_tool_use?: boolean
  }
  loaded_instances?: Array<{
    id?: string
    config?: {
      context_length?: number
    }
  }>
}

export interface LMStudioModelsResponse {
  object: string
  data: LMStudioModel[]
}

export interface LMStudioAPIV1Model {
  type?: string
  publisher?: string
  key: string
  display_name?: string
  architecture?: string
  format?: string
  max_context_length?: number
  capabilities?: {
    vision?: boolean
    trained_for_tool_use?: boolean
  }
  loaded_instances?: Array<{
    id?: string
    config?: {
      context_length?: number
    }
  }>
}

export interface LMStudioAPIV1ModelsResponse {
  models?: LMStudioAPIV1Model[]
}

export type ModelType = 'chat' | 'embedding' | 'unknown'

export type LoadingStatus = 'not_loaded' | 'loading' | 'loaded' | 'error'

export interface ModelLoadingState {
  status: LoadingStatus
  startTime?: number
  progress?: number
  eta?: number
  error?: string
}

export interface ModelValidationError {
  type: 'offline' | 'not_found' | 'network' | 'permission' | 'timeout' | 'unknown'
  severity: 'low' | 'medium' | 'high' | 'critical'
  message: string
  canRetry: boolean
  autoFixAvailable: boolean
}

export interface AutoFixSuggestion {
  action: string
  command?: string
  steps?: string[]
  automated: boolean
}

export interface SimilarModel {
  model: string
  similarity: number
  reason: string
}

export interface CacheStats {
  size: number
  entries: Array<{
    baseURL: string
    age: number
    modelCount: number
    ttl: number
  }>
}

export interface LMStudioValidationResult {
  status: 'success' | 'error'
  model: string
  availableModels: string[]
  message: string
  errorCategory?: string
  severity?: string
  canRetry?: boolean
  autoFixAvailable?: boolean
  autoFixSuggestions?: AutoFixSuggestion[]
  steps?: string[]
  similarModels?: Array<{
    model: string
    similarity: number
    reason: string
  }>
  cacheInfo?: {
    age: number
    valid: boolean
    totalCacheEntries: number
  }
  performanceHint?: string
}
