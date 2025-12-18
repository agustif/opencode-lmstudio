// Core types for LM Studio plugin
export interface LMStudioModel {
  id: string
  object: string
  created: number
  owned_by: string
}

export interface LMStudioModelsResponse {
  object: string
  data: LMStudioModel[]
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