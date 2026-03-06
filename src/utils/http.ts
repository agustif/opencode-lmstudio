import * as fs from 'fs'
import * as path from 'path'

export interface LMStudioAuthConfig {
  type: 'api' | null
  key: string | null
}

export function getLMStudioAuth(): LMStudioAuthConfig {
  const authFile = path.join(process.env.HOME || '', '.local', 'share', 'opencode', 'auth.json')
  
  try {
    const authData = JSON.parse(fs.readFileSync(authFile, 'utf8'))
    const lmstudioConfig = authData['lmstudio']
    
    if (!lmstudioConfig) {
      return { type: null, key: null }
    }
    
    if (lmstudioConfig.type !== 'api') {
      return { type: null, key: null }
    }
    
    return {
      type: 'api',
      key: lmstudioConfig.key || null
    }
  } catch (error) {
    console.warn(`[opencode-lmstudio] Failed to read LM Studio auth from ${authFile}`, error instanceof Error ? error.message : String(error))
    return { type: null, key: null }
  }
}

export function getHeaders(): Record<string, string> {
  const config = getLMStudioAuth()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  
  // Only add Authorization header if API key is configured
  if (config.key) {
    headers['Authorization'] = `Bearer ${config.key}`
  }
  
  return headers
}
