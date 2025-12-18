// Test script to verify the plugin exports correctly
import { LMStudioPlugin } from "./src/index.ts"

console.log("Plugin loaded successfully!")
console.log("Plugin type:", typeof LMStudioPlugin)

// Test that it's a function
if (typeof LMStudioPlugin === "function") {
  console.log("✓ Plugin is a function")
} else {
  console.error("✗ Plugin is not a function")
  process.exit(1)
}

// Test that it can be called (mock input)
const mockInput = {
  client: {} as any,
  project: {} as any,
  directory: "/tmp",
  worktree: "/tmp",
  $: {} as any,
}

LMStudioPlugin(mockInput)
  .then((hooks) => {
    console.log("✓ Plugin initializes successfully")
    console.log("Hooks returned:", Object.keys(hooks))
    
    if (hooks.config) {
      console.log("✓ Config hook exists")
    } else {
      console.error("✗ Config hook missing")
      process.exit(1)
    }
    
    if (hooks.event) {
      console.log("✓ Event hook exists")
    } else {
      console.error("✗ Event hook missing")
      process.exit(1)
    }
    
    console.log("\n✅ All tests passed!")
  })
  .catch((error) => {
    console.error("✗ Plugin initialization failed:", error)
    process.exit(1)
  })

