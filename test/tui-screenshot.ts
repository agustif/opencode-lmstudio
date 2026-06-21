import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

interface CellShift {
  bgColorMode?: number
  bgColor?: number
  fgColorMode?: number
  fgColor?: number
  blink?: number
  bold?: number
  dim?: number
  inverse?: number
  invisible?: number
  italic?: number
  overline?: number
  strike?: number
  underline?: number
}

interface TerminalCapture {
  getViewableBuffer(): string[][]
  getCursor(): { baseY: number }
  serialize(): { shifts: Map<string, CellShift> }
}

interface Crop {
  x: number
  y: number
  width: number
  height: number
}

interface ScreenshotDefinition {
  title: string
  description: string
  crop: Crop
}

interface StyledCell {
  char: string
  style: CellShift
}

const screenshotDefinitions = {
  "opencode-home": {
    title: "Home · LM Studio",
    description: "OpenCode home view with the selected LM Studio text model",
    crop: { x: 12, y: 7, width: 76, height: 14 },
  },
  "opencode-models": {
    title: "Models · LM Studio",
    description: "OpenCode model picker filtered to generative LM Studio models",
    crop: { x: 20, y: 8, width: 60, height: 10 },
  },
  "opencode-model-search": {
    title: "Model search · gemma-4-12b",
    description: "OpenCode model picker filtered to an LM Studio vision model",
    crop: { x: 20, y: 8, width: 60, height: 10 },
  },
  "opencode-selected-model": {
    title: "Selected · gemma-4-12b",
    description: "OpenCode home view after selecting an LM Studio vision model",
    crop: { x: 12, y: 7, width: 76, height: 14 },
  },
  "opencode-chat": {
    title: "Chat · LM Studio",
    description: "OpenCode streaming a response from the authenticated LM Studio fixture",
    crop: { x: 2, y: 0, width: 76, height: 9 },
  },
} as const satisfies Record<string, ScreenshotDefinition>

export type ScreenshotName = keyof typeof screenshotDefinitions

const expectedPackageVersion = process.env.OPENCODE_LMSTUDIO_EXPECTED_VERSION
const testSource = process.env.OPENCODE_LMSTUDIO_TEST_SOURCE
const screenshotDirectory = expectedPackageVersion && testSource
  ? join(process.cwd(), "tui-artifacts", `${testSource}-${expectedPackageVersion}`)
  : join(process.cwd(), "docs", "screenshots")

const artboardWidth = 720
const terminalTop = 58
const terminalPadding = 16
const bottomPadding = 20
const charWidth = 8.45
const lineHeight = 21
const fontSize = 14
const defaultForeground = "#ffffff"
const defaultBackground = "#080808"

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

function ansi256ToHex(index: number): string {
  const basic = [
    "#000000", "#cd0000", "#00cd00", "#cdcd00",
    "#0000ee", "#cd00cd", "#00cdcd", "#e5e5e5",
    "#7f7f7f", "#ff0000", "#00ff00", "#ffff00",
    "#5c5cff", "#ff00ff", "#00ffff", "#ffffff",
  ]
  if (index < 16) return basic[index] ?? defaultForeground
  if (index < 232) {
    const value = index - 16
    const levels = [0, 95, 135, 175, 215, 255]
    const red = levels[Math.floor(value / 36)] ?? 0
    const green = levels[Math.floor((value % 36) / 6)] ?? 0
    const blue = levels[value % 6] ?? 0
    return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`
  }
  const gray = 8 + (index - 232) * 10
  const channel = gray.toString(16).padStart(2, "0")
  return `#${channel}${channel}${channel}`
}

function terminalColor(mode: number | undefined, color: number | undefined, fallback: string): string {
  if (mode === undefined || color === undefined) return fallback
  if (mode === 0x3000000) return `#${color.toString(16).padStart(6, "0")}`
  return ansi256ToHex(color)
}

function styledBuffer(terminal: TerminalCapture): StyledCell[][] {
  const buffer = terminal.getViewableBuffer()
  const { shifts } = terminal.serialize()
  const { baseY } = terminal.getCursor()
  const state: CellShift = {
    bgColorMode: 0x2000000,
    bgColor: 232,
    fgColorMode: 0x2000000,
    fgColor: 15,
  }

  return buffer.map((row, y) => row.map((char, x) => {
    Object.assign(state, shifts.get(`${x},${y + baseY}`))
    return { char: char || " ", style: { ...state } }
  }))
}

function replaceRowMatch(row: StyledCell[], pattern: RegExp, replacement: string): void {
  const text = row.map((cell) => cell.char).join("")
  const match = pattern.exec(text)
  if (!match || match.index === undefined) return
  const start = match.index
  const clearThrough = Math.max(start + match[0].length, start + replacement.length)
  const style = { ...(row[start]?.style ?? {}) }
  for (let index = start; index < clearThrough && index < row.length; index += 1) {
    row[index] = { char: replacement[index - start] ?? " ", style }
  }
}

function normalizeBuffer(rows: StyledCell[][]): void {
  for (const row of rows) {
    const text = row.map((cell) => cell.char).join("")
    if (/\bTip\b/.test(text)) {
      for (const cell of row) cell.char = " "
      continue
    }
    replaceRowMatch(row, /Ask anything\.\.\. "[^"]*"/, 'Ask anything... "Ask about your code"')
    replaceRowMatch(row, /\b\d+(?:\.\d+)?(?:ms|s)\b/, "<time>")
  }
}

function cropBuffer(rows: StyledCell[][], crop: Crop): StyledCell[][] {
  return Array.from({ length: crop.height }, (_, rowIndex) => {
    const source = rows[crop.y + rowIndex] ?? []
    return Array.from({ length: crop.width }, (_, columnIndex) =>
      source[crop.x + columnIndex] ?? { char: " ", style: {} })
  })
}

function colorsForStyle(style: CellShift): { foreground: string; background: string } {
  let foreground = terminalColor(style.fgColorMode, style.fgColor, defaultForeground)
  let background = terminalColor(style.bgColorMode, style.bgColor, defaultBackground)
  if (style.inverse) [foreground, background] = [background, foreground]
  return { foreground, background }
}

function renderBackgrounds(rows: StyledCell[][], terminalX: number, terminalY: number): string {
  const rectangles: string[] = []
  rows.forEach((row, rowIndex) => {
    let start = 0
    while (start < row.length) {
      const background = colorsForStyle(row[start]?.style ?? {}).background
      let end = start + 1
      while (end < row.length && colorsForStyle(row[end]?.style ?? {}).background === background) end += 1
      if (background !== defaultBackground) {
        rectangles.push(
          `  <rect x="${terminalX + start * charWidth}" y="${terminalY + rowIndex * lineHeight}" width="${(end - start) * charWidth + 0.2}" height="${lineHeight}" fill="${background}"/>`,
        )
      }
      start = end
    }
  })
  return rectangles.join("\n")
}

function renderText(rows: StyledCell[][], terminalX: number, terminalY: number): string {
  const runs: string[] = []
  rows.forEach((row, rowIndex) => {
    let start = 0
    while (start < row.length) {
      const style = row[start]?.style ?? {}
      const colors = colorsForStyle(style)
      const key = [colors.foreground, Boolean(style.bold), Boolean(style.dim), Boolean(style.italic)].join(":")
      let end = start + 1
      while (end < row.length) {
        const nextStyle = row[end]?.style ?? {}
        const nextColors = colorsForStyle(nextStyle)
        const nextKey = [nextColors.foreground, Boolean(nextStyle.bold), Boolean(nextStyle.dim), Boolean(nextStyle.italic)].join(":")
        if (nextKey !== key) break
        end += 1
      }
      const value = row.slice(start, end)
        .map((cell) => cell.style.invisible ? " " : cell.char)
        .join("")
        .trimEnd()
      if (value.trim()) {
        const decorations = [style.underline ? "underline" : "", style.strike ? "line-through" : ""]
          .filter(Boolean)
          .join(" ")
        runs.push(
          `  <text x="${terminalX + start * charWidth}" y="${terminalY + rowIndex * lineHeight + 15}" fill="${colors.foreground}" opacity="${style.dim ? 0.62 : 1}" font-weight="${style.bold ? 650 : 400}" font-style="${style.italic ? "italic" : "normal"}"${decorations ? ` text-decoration="${decorations}"` : ""} xml:space="preserve">${escapeXml(value)}</text>`,
        )
      }
      start = end
    }
  })
  return runs.join("\n")
}

export function writeTerminalScreenshot(name: ScreenshotName, terminal: TerminalCapture): void {
  const definition = screenshotDefinitions[name]
  const rows = styledBuffer(terminal)
  normalizeBuffer(rows)
  const cropped = cropBuffer(rows, definition.crop)
  const contentWidth = definition.crop.width * charWidth
  const terminalPanelWidth = contentWidth + terminalPadding * 2
  const terminalPanelHeight = definition.crop.height * lineHeight + terminalPadding * 2
  const terminalPanelX = (artboardWidth - terminalPanelWidth) / 2
  const terminalX = terminalPanelX + terminalPadding
  const terminalY = terminalTop + terminalPadding
  const height = terminalTop + terminalPanelHeight + bottomPadding

  mkdirSync(screenshotDirectory, { recursive: true })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${artboardWidth}" height="${height}" viewBox="0 0 ${artboardWidth} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(definition.title)}</title>
  <desc id="desc">${escapeXml(definition.description)}. Captured by Microsoft TUI Test.</desc>
  <rect x="0.5" y="0.5" width="${artboardWidth - 1}" height="${height - 1}" rx="10" fill="#111318" stroke="#30363d"/>
  <line x1="1" y1="47.5" x2="${artboardWidth - 1}" y2="47.5" stroke="#30363d"/>
  <circle cx="20" cy="24" r="4.5" fill="#ff5f57"/>
  <circle cx="34" cy="24" r="4.5" fill="#febc2e"/>
  <circle cx="48" cy="24" r="4.5" fill="#28c840"/>
  <text x="68" y="29" fill="#f0f2f5" font-family="ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="14" font-weight="600">${escapeXml(definition.title)}</text>
  <text x="696" y="28" text-anchor="end" fill="#7d8590" font-family="ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="10" font-weight="600" letter-spacing="0.08em">REAL OPENCODE TUI</text>
  <rect x="${terminalPanelX}" y="${terminalTop}" width="${terminalPanelWidth}" height="${terminalPanelHeight}" rx="8" fill="${defaultBackground}" stroke="#262b33"/>
  <g font-family="SFMono-Regular, Cascadia Code, Consolas, Liberation Mono, monospace" font-size="${fontSize}" text-rendering="geometricPrecision">
${renderBackgrounds(cropped, terminalX, terminalY)}
${renderText(cropped, terminalX, terminalY)}
  </g>
</svg>
`

  writeFileSync(join(screenshotDirectory, `${name}.svg`), svg)
}
