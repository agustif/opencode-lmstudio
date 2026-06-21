import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { inflateSync } from "node:zlib"
import { chromium } from "playwright"

interface TraceDataPoint {
  data: string
  time: number
}

interface TraceResizePoint {
  rows: number
  cols: number
}

type TracePoint = TraceDataPoint | TraceResizePoint

interface TuiTrace {
  tracePoints: TracePoint[]
}

interface ScreenshotDefinition {
  name: string
  testTitle: string
  expectedText: string[]
}

interface RenderTuiScreenshotsOptions {
  outputDirectory: string
  traceDirectory?: string
}

const screenshotDefinitions: ScreenshotDefinition[] = [
  {
    name: "opencode-home",
    testTitle: "home view shows the selected LM Studio model and provider",
    expectedText: ["Ask anything", "Qwen2.5 Coder 7B Instruct"],
  },
  {
    name: "opencode-models",
    testTitle: "model picker lists text and vision models and excludes embeddings",
    expectedText: ["Select model", "Qwen2.5 Coder 7B Instruct", "Gemma 4 12B"],
  },
  {
    name: "opencode-model-search",
    testTitle: "model search filters to an LM Studio vision model",
    expectedText: ["Select model", "Gemma 4 12B"],
  },
  {
    name: "opencode-selected-model",
    testTitle: "selected vision model returns to the OpenCode home view",
    expectedText: ["Ask anything", "Gemma 4 12B"],
  },
  {
    name: "opencode-chat",
    testTitle: "chat view streams a response through the selected LM Studio model",
    expectedText: ["TUI_PROMPT", "FIXTURE_OK", "Qwen2.5 Coder 7B Instruct"],
  },
]

const require = createRequire(import.meta.url)
const xtermScript = require.resolve("@xterm/xterm")
const xtermCss = join(xtermScript, "..", "..", "css", "xterm.css")
const fontPath = require.resolve("@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2")

function traceRetry(filename: string): number {
  return Number(filename.match(/-retry(\d+)$/)?.[1] ?? 0)
}

function findTrace(traceDirectory: string, testTitle: string): string {
  const stem = `test-opencode.tui.test.ts-${testTitle.replaceAll(/[ /\\<>:"'|?*]/g, "-")}`
  const candidates = readdirSync(traceDirectory)
    .filter((filename) => filename === stem || filename.startsWith(`${stem}-retry`))
    .sort((left, right) => traceRetry(left) - traceRetry(right))
  const filename = candidates.at(-1)
  if (!filename) throw new Error(`TUI trace is missing for: ${testTitle}`)
  return join(traceDirectory, filename)
}

function readTrace(path: string): TuiTrace {
  return JSON.parse(inflateSync(readFileSync(path)).toString("utf8")) as TuiTrace
}

export async function renderTuiScreenshots({
  outputDirectory,
  traceDirectory = join(process.cwd(), "tui-traces"),
}: RenderTuiScreenshotsOptions): Promise<void> {
  if (!existsSync(traceDirectory)) throw new Error(`TUI trace directory is missing: ${traceDirectory}`)
  mkdirSync(outputDirectory, { recursive: true })

  const fontData = readFileSync(fontPath).toString("base64")
  const browser = await chromium.launch({ args: ["--font-render-hinting=none"] })
  try {
    const context = await browser.newContext({
      deviceScaleFactor: 2,
      viewport: { width: 1280, height: 800 },
    })

    for (const definition of screenshotDefinitions) {
      const trace = readTrace(findTrace(traceDirectory, definition.testTitle))
      const page = await context.newPage()
      await page.setContent(`<!doctype html>
<html>
  <head><meta charset="utf-8"></head>
  <body><main id="capture"><div id="terminal"></div></main></body>
</html>`)
      await page.addStyleTag({ path: xtermCss })
      await page.addStyleTag({ content: `
@font-face {
  font-family: "TUI Capture";
  font-style: normal;
  font-weight: 400;
  font-display: block;
  src: url(data:font/woff2;base64,${fontData}) format("woff2");
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; width: max-content; background: #080808; }
#capture { display: inline-block; padding: 16px; background: #080808; }
#terminal { width: 1000px; height: 600px; background: #080808; }
.xterm { padding: 0; }
.xterm-viewport { overflow: hidden !important; }
` })
      await page.addScriptTag({ path: xtermScript })
      await page.evaluate(() => (
        globalThis as unknown as { document: { fonts: { ready: Promise<void> } } }
      ).document.fonts.ready)

      const renderedText = await page.evaluate(async ({ tracePoints }) => {
        interface BrowserElement {}
        type BrowserTerminal = {
          buffer: { active: { length: number; getLine(index: number): { translateToString(trim: boolean): string } | undefined } }
          open(element: BrowserElement): void
          resize(columns: number, rows: number): void
          write(data: string, callback?: () => void): void
        }
        type BrowserTerminalConstructor = new (options: Record<string, unknown>) => BrowserTerminal
        const browserGlobal = globalThis as unknown as {
          Terminal: BrowserTerminalConstructor
          document: { querySelector(selector: string): BrowserElement | null }
          requestAnimationFrame(callback: () => void): number
        }
        const Terminal = browserGlobal.Terminal
        const terminal = new Terminal({
          allowTransparency: false,
          cols: 100,
          rows: 30,
          convertEol: false,
          cursorBlink: false,
          customGlyphs: true,
          disableStdin: true,
          fontFamily: '"TUI Capture", monospace',
          fontSize: 15,
          fontWeight: "400",
          fontWeightBold: "700",
          letterSpacing: 0,
          lineHeight: 1,
          minimumContrastRatio: 1,
          scrollback: 0,
          theme: {
            background: "#080808",
            foreground: "#ffffff",
            cursor: "#080808",
            cursorAccent: "#080808",
          },
        })
        const target = browserGlobal.document.querySelector("#terminal")
        if (!target) throw new Error("xterm target is missing")
        terminal.open(target)

        const write = (data: string) => new Promise<void>((resolve) => terminal.write(data, resolve))
        for (const point of tracePoints) {
          if ("rows" in point) terminal.resize(point.cols, point.rows)
          if ("data" in point && point.data) await write(point.data)
        }
        await write("\u001b[?25l")
        await new Promise<void>((resolve) => browserGlobal.requestAnimationFrame(() =>
          browserGlobal.requestAnimationFrame(() => resolve())))

        return Array.from({ length: terminal.buffer.active.length }, (_, index) =>
          terminal.buffer.active.getLine(index)?.translateToString(true) ?? "",
        ).join("\n")
      }, { tracePoints: trace.tracePoints })

      for (const expected of definition.expectedText) {
        if (!renderedText.includes(expected)) {
          throw new Error(`${definition.name} xterm replay is missing expected text: ${expected}`)
        }
      }

      const outputPath = join(outputDirectory, `${definition.name}.png`)
      const png = await page.locator("#capture").screenshot({ type: "png" })
      writeFileSync(outputPath, png)
      if (statSync(outputPath).size < 10_000) throw new Error(`${outputPath} is unexpectedly small`)
      await page.close()
      console.log(`Rendered ${outputPath} from the raw Microsoft TUI Test trace with browser xterm.js`)
    }

    await context.close()
  } finally {
    await browser.close()
  }
}
