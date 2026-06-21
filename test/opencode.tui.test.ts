import { expect, Key, test } from "@microsoft/tui-test"

interface SerializableTerminal {
  serialize(): { view: string }
}

async function waitForModelPickerQuery(
  terminal: SerializableTerminal,
  query: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const lines = terminal.serialize().view.split("\n")
    const titleIndex = lines.findIndex((line) => line.includes("Select model"))
    if (titleIndex !== -1 && lines.slice(titleIndex + 1, titleIndex + 5).some((line) => line.includes(query))) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Model picker did not apply query: ${query}`)
}

const expectedProviderName = process.env.OPENCODE_LMSTUDIO_PROVIDER_NAME ?? "LM Studio TUI Test"

test.use({
  program: {
    file: "bash",
    args: ["test/opencode-fixture.sh"],
  },
  columns: 100,
  rows: 30,
})

test("home view shows the selected LM Studio model and provider", async ({ terminal }) => {
  await expect(terminal.getByText("Ask anything", { strict: false })).toBeVisible({ timeout: 40_000 })
  await expect(terminal.getByText("qwen2.5-coder-7b-instruct", { strict: false })).toBeVisible()
  await expect(terminal.getByText(expectedProviderName, { strict: false })).toBeVisible()
  await expect(terminal.getByText("text-embedding-nomic-embed-text-v1.5", { strict: false })).not.toBeVisible()

  terminal.kill()
})

test("model picker lists LLM and VLM models and excludes embeddings", async ({ terminal }) => {
  await expect(terminal.getByText("Ask anything", { strict: false })).toBeVisible({ timeout: 40_000 })
  terminal.keyPress("x", { ctrl: true })
  terminal.write("m")
  await expect(terminal.getByText("Select model", { strict: false })).toBeVisible()
  terminal.write(expectedProviderName)
  await waitForModelPickerQuery(terminal, expectedProviderName)
  await expect(terminal.getByText("qwen2.5-coder-7b-instruct", { strict: false })).toBeVisible()
  await expect(terminal.getByText("google/gemma-4-12b", { strict: false })).toBeVisible()
  await expect(terminal.getByText(expectedProviderName, { strict: false })).toBeVisible()
  await expect(terminal.getByText("text-embedding-nomic-embed-text-v1.5", { strict: false })).not.toBeVisible()
  terminal.kill()
})

test("model search filters to an LM Studio vision model", async ({ terminal }) => {
  await expect(terminal.getByText("Ask anything", { strict: false })).toBeVisible({ timeout: 40_000 })
  terminal.keyPress("x", { ctrl: true })
  terminal.write("m")
  await expect(terminal.getByText("Select model", { strict: false })).toBeVisible()
  terminal.write("google/gemma-4-12b")
  await waitForModelPickerQuery(terminal, "google/gemma-4-12b")
  await expect(terminal.getByText("google/gemma-4-12b", { strict: false })).toBeVisible()
  await expect(terminal.getByText(expectedProviderName, { strict: false })).toBeVisible()
  await expect(terminal.getByText("qwen2.5-coder-7b-instruct", { strict: false })).not.toBeVisible()
  terminal.kill()
})

test("selected VLM returns to the OpenCode home view", async ({ terminal }) => {
  await expect(terminal.getByText("Ask anything", { strict: false })).toBeVisible({ timeout: 40_000 })
  terminal.keyPress("x", { ctrl: true })
  terminal.write("m")
  await expect(terminal.getByText("Select model", { strict: false })).toBeVisible()
  terminal.write("google/gemma-4-12b")
  await waitForModelPickerQuery(terminal, "google/gemma-4-12b")
  await expect(terminal.getByText("google/gemma-4-12b", { strict: false })).toBeVisible()
  terminal.keyPress(Key.Enter)
  await expect(terminal.getByText("Ask anything", { strict: false })).toBeVisible()
  await expect(terminal.getByText("google/gemma-4-12b", { strict: false })).toBeVisible()
  terminal.kill()
})

test("chat view streams a response through the selected LM Studio model", async ({ terminal }) => {
  await expect(terminal.getByText("Ask anything", { strict: false })).toBeVisible({ timeout: 40_000 })
  terminal.write("TUI_PROMPT")
  terminal.keyPress(Key.Enter)
  await expect(terminal.getByText("FIXTURE_OK", { strict: false })).toBeVisible({ timeout: 40_000 })
  await expect(terminal.getByText("qwen2.5-coder-7b-instruct", { strict: false })).toBeVisible()
  terminal.kill()
})
