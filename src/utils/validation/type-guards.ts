export function isPluginHookInput(input: any): input is { sessionID?: string; agent?: string; model?: any; provider?: any; message?: any; event?: any } {
  return input && typeof input === 'object'
}

export function isLMStudioProvider(provider: any): boolean {
  return provider &&
         typeof provider === 'object' &&
         provider.info &&
         typeof provider.info.id === 'string' &&
         /^lm.?studio/i.test(provider.info.id)
}

export function isValidModel(model: any): model is { id: string; [key: string]: any } {
  return model && 
         typeof model === 'object' && 
         typeof model.id === 'string' && 
         model.id.length > 0
}

