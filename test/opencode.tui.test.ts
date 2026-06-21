import { expect, Key, test } from "@microsoft/tui-test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

interface SerializableTerminal {
  serialize(): { view: string }
}

const serializedTerminalWidth = 102

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

function normalizeTerminalLine(line: string): string {
  const characters = [...line]
  if (characters.length === serializedTerminalWidth) return line
  const leftBorder = characters[0]
  const rightBorder = characters.at(-1)
  if (leftBorder && rightBorder && "│╭╰".includes(leftBorder) && "│╮╯".includes(rightBorder)) {
    const content = characters.slice(1, -1).slice(0, serializedTerminalWidth - 2)
    return `${leftBorder}${content.join("")}${" ".repeat(serializedTerminalWidth - 2 - content.length)}${rightBorder}`
  }
  return characters.slice(0, serializedTerminalWidth).join("").padEnd(serializedTerminalWidth)
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

const expectedPackageVersion = process.env.OPENCODE_LMSTUDIO_EXPECTED_VERSION
const testSource = process.env.OPENCODE_LMSTUDIO_TEST_SOURCE
const expectedProviderName = process.env.OPENCODE_LMSTUDIO_PROVIDER_NAME ?? "LM Studio TUI Test"
const screenshotDirectory = expectedPackageVersion && testSource
  ? join(process.cwd(), "tui-artifacts", `${testSource}-${expectedPackageVersion}`)
  : join(process.cwd(), "docs", "screenshots")

function writeTerminalScreenshot(name: string, terminal: SerializableTerminal, title: string): void {
  const normalized = terminal.serialize().view
    .replace(/\S*opencode-lmstudio-tui[.A-Za-z0-9_-]*/g, "/tmp/opencode-lmstudio-tui")
    .replace(/\b\d+(?:\.\d+)?(?:ms|s)\b/g, "<time>")
  const sourceLines = normalized.split("\n")
  const terminalWidth = serializedTerminalWidth
  let logoRow = 0
  const lines = sourceLines.map((line) => {
    if (title === "OpenCode with LM Studio" && !line.includes("╹") && (line.match(/[▀█▄]/g)?.length ?? 0) >= 4) {
      const contentWidth = Math.max(terminalWidth - 2, 0)
      const content = logoRow++ === 1 ? "OpenCode" : ""
      const left = Math.floor((contentWidth - content.length) / 2)
      return `│${" ".repeat(left)}${content}${" ".repeat(contentWidth - left - content.length)}│`
    }
    if (line.includes("/tmp/opencode-lmstudio-tui") && line.endsWith("│")) {
      const contentWidth = Math.max(terminalWidth - 2, 0)
      const left = "  /tmp/opencode-lmstudio-tui"
      const version = line.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? ""
      const right = `${version}  `
      const padding = " ".repeat(Math.max(contentWidth - left.length - right.length, 1))
      return `│${left}${padding}${right}│`
    }
    if (line.includes("Ask anything...") && line.endsWith("│")) {
      const prefix = line.slice(0, line.indexOf("Ask anything..."))
      const prompt = 'Ask anything... "Ask about your code"'
      const padding = " ".repeat(Math.max([...line].length - [...prefix].length - [...prompt].length - 1, 0))
      return `${prefix}${prompt}${padding}│`
    }
    if (line.includes(" · <time>") && line.endsWith("│")) {
      const prefix = line.slice(0, line.indexOf("<time>")) + "<time>"
      return `${prefix}${" ".repeat(Math.max(terminalWidth - [...prefix].length - 1, 0))}│`
    }
    if (!/\bTip\b/.test(line) || !line.startsWith("│") || !line.endsWith("│")) return line
    return `│${" ".repeat(Math.max([...line].length - 2, 0))}│`
  }).map(normalizeTerminalLine)
  const columns = serializedTerminalWidth
  const fontSize = 14
  const lineHeight = 20
  const padding = 24
  const titleHeight = 42
  const width = Math.ceil(columns * 8.45 + padding * 2)
  const height = titleHeight + lines.length * lineHeight + padding
  mkdirSync(screenshotDirectory, { recursive: true })

  const text = lines.map((line, index) =>
    `  <text x="${padding}" y="${titleHeight + (index + 1) * lineHeight}" xml:space="preserve">${escapeXml(line)}</text>`,
  ).join("\n")

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(title)}</title>
  <desc id="desc">OpenCode terminal captured by Microsoft TUI Test</desc>
  <rect width="100%" height="100%" rx="12" fill="#0b0d10"/>
  <circle cx="22" cy="21" r="5" fill="#ff5f57"/>
  <circle cx="38" cy="21" r="5" fill="#febc2e"/>
  <circle cx="54" cy="21" r="5" fill="#28c840"/>
  <text x="${width / 2}" y="26" text-anchor="middle" fill="#9aa4b2" font-family="ui-sans-serif, system-ui" font-size="13">${escapeXml(title)}</text>
  <g fill="#e6edf3" font-family="SFMono-Regular, Consolas, Liberation Mono, monospace" font-size="${fontSize}">
${text}
  </g>
</svg>
`

  writeFileSync(join(screenshotDirectory, `${name}.svg`), svg)
}

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

  writeTerminalScreenshot("opencode-home", terminal, "OpenCode with LM Studio")
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
  writeTerminalScreenshot("opencode-models", terminal, "Discovered LM Studio models")
  terminal.kill()
})

test("model search selects a VLM and returns it to the home view", async ({ terminal }) => {
  await expect(terminal.getByText("Ask anything", { strict: false })).toBeVisible({ timeout: 40_000 })
  terminal.keyPress("x", { ctrl: true })
  terminal.write("m")
  await expect(terminal.getByText("Select model", { strict: false })).toBeVisible()
  terminal.write("google/gemma-4-12b")
  await waitForModelPickerQuery(terminal, "google/gemma-4-12b")
  await expect(terminal.getByText("google/gemma-4-12b", { strict: false })).toBeVisible()
  await expect(terminal.getByText(expectedProviderName, { strict: false })).toBeVisible()
  await expect(terminal.getByText("qwen2.5-coder-7b-instruct", { strict: false })).not.toBeVisible()
  writeTerminalScreenshot("opencode-model-search", terminal, "Filtered LM Studio models")

  terminal.keyPress(Key.Enter)
  await expect(terminal.getByText("Ask anything", { strict: false })).toBeVisible()
  await expect(terminal.getByText("google/gemma-4-12b", { strict: false })).toBeVisible()
  writeTerminalScreenshot("opencode-selected-model", terminal, "Selected LM Studio vision model")
  terminal.kill()
})

test("chat view streams a response through the selected LM Studio model", async ({ terminal }) => {
  await expect(terminal.getByText("Ask anything", { strict: false })).toBeVisible({ timeout: 40_000 })
  terminal.write("TUI_PROMPT")
  terminal.keyPress(Key.Enter)
  await expect(terminal.getByText("FIXTURE_OK", { strict: false })).toBeVisible({ timeout: 40_000 })
  await expect(terminal.getByText("qwen2.5-coder-7b-instruct", { strict: false })).toBeVisible()
  writeTerminalScreenshot("opencode-chat", terminal, "LM Studio chat response")
  terminal.kill()
})
