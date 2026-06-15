import { expect, test } from "@microsoft/tui-test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

interface SerializableTerminal {
  serialize(): { view: string }
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

function writeTerminalScreenshot(name: string, terminal: SerializableTerminal, title: string): void {
  const normalized = terminal.serialize().view
    .replace(/\S*opencode-lmstudio-tui[.A-Za-z0-9_-]*/g, "/tmp/opencode-lmstudio-tui")
    .replace(/\b\d+(?:\.\d+)?(?:ms|s)\b/g, "<time>")
  const sourceLines = normalized.split("\n")
  const terminalWidth = Math.max(...sourceLines.map((line) => [...line].length))
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
    if (!/\bTip\b/.test(line) || !line.startsWith("│") || !line.endsWith("│")) return line
    return `│${" ".repeat(Math.max([...line].length - 2, 0))}│`
  })
  const columns = Math.max(...lines.map((line) => [...line].length))
  const fontSize = 14
  const lineHeight = 20
  const padding = 24
  const titleHeight = 42
  const width = Math.ceil(columns * 8.45 + padding * 2)
  const height = titleHeight + lines.length * lineHeight + padding
  const outputDirectory = join(process.cwd(), "docs", "screenshots")
  mkdirSync(outputDirectory, { recursive: true })

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

  writeFileSync(join(outputDirectory, `${name}.svg`), svg)
}

test.use({
  program: {
    file: "bash",
    args: ["test/opencode-fixture.sh"],
  },
  columns: 100,
  rows: 30,
})

test("covers every OpenCode surface affected by the plugin", async ({ terminal }) => {
  await expect(terminal.getByText("Ask anything", { strict: false })).toBeVisible({ timeout: 40_000 })
  await expect(terminal.getByText("qwen2.5-coder-7b-instruct", { strict: false })).toBeVisible()
  await expect(terminal.getByText("LM Studio TUI Test", { strict: false })).toBeVisible()
  await expect(terminal.getByText("text-embedding-nomic-embed-text-v1.5", { strict: false })).not.toBeVisible()

  writeTerminalScreenshot("opencode-home", terminal, "OpenCode with LM Studio")

  terminal.keyPress("x", { ctrl: true })
  terminal.write("m")
  await expect(terminal.getByText("Select model", { strict: false })).toBeVisible()
  terminal.write("google/gemma-4-12b")
  await expect(terminal.getByText("google/gemma-4-12b                LM Studio TUI Test", { strict: false })).toBeVisible()
  await expect(terminal.getByText("text-embedding-nomic-embed-text-v1.5", { strict: false })).not.toBeVisible()
  writeTerminalScreenshot("opencode-models", terminal, "Discovered LM Studio models")

  terminal.kill()
})
