import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { createLMStudioFixture } from "./fixtures/lmstudio-server.ts"

const root = process.argv[2]
if (!root) throw new Error("Fixture root argument is required")

const fixture = await createLMStudioFixture("tui", "tui-token", "FIXTURE_OK")
writeFileSync(join(root, "server-url"), fixture.serverURL)

async function shutdown(): Promise<never> {
  await fixture.close()
  process.exit(0)
}

process.once("SIGINT", () => { void shutdown() })
process.once("SIGTERM", () => { void shutdown() })
await new Promise<never>(() => undefined)
