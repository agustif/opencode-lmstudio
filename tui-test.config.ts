import { defineConfig } from "@microsoft/tui-test"

export default defineConfig({
  testMatch: "**/*.tui.test.ts",
  workers: 1,
  retries: 2,
  timeout: 60_000,
  globalTimeout: 360_000,
  shellReadyTimeout: 30_000,
  expect: {
    timeout: 20_000,
  },
  trace: true,
  traceFolder: "tui-traces",
  use: {
    columns: 100,
    rows: 30,
  },
})
