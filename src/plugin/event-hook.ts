import { validateHookInput } from '../utils/validation/index.ts'

export function createEventHook() {
  return async ({ event }: { event: any }) => {
    // Validate event input
    const validation = validateHookInput('event', { event })
    if (!validation.isValid) {
      console.error("[opencode-lmstudio] Invalid event input:", validation.errors)
      return
    }
    
    // Monitor for session events to provide LM Studio status
    if (event.type === "session.created" || event.type === "session.updated") {
      // Could add health check monitoring here in the future
    }
  }
}
