import { ModelStatusCache } from '../cache/model-status-cache.ts'
import { fetchModelsDirect } from '../utils/lmstudio-api.ts'

const modelStatusCache = new ModelStatusCache()

export function getLoadedModels(baseURL: string = "http://127.0.0.1:1234", apiKey?: string): Promise<string[]> {
  return modelStatusCache.getModels(baseURL, async () => {
    return await fetchModelsDirect(baseURL, apiKey)
  })
}
