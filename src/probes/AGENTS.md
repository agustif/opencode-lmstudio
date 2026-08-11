# Probe-Specific Learnings

## Writing Probes

- Capability flags normally stay `true` or undefined. A probe may return `false`
  only when the provider reports an authoritative boolean; discovery uses that
  value as an internal fallback-denial sentinel and does not emit false config
  flags. Missing or wrong-type values remain unknown so models.dev may fill them.
- `EMPTY_RESULT` is `Object.freeze()`d. Never mutate after returning it.
- **Never write to stdout/stderr** (no `console.*`). This runs in opencode's config hook at startup; any output leaks into opencode. Failures degrade silently (return `EMPTY_RESULT`).
- **Never read a body with raw `res.json()`/`res.text()`.** Use `readJson()`/`readBody()` from `./util` — they bound the body read with a timeout and cancel the stream. A raw read has no timeout and can hang forever if a server sends headers then stalls the body.
- `probeFetch()` returns `Response | undefined`. It does NOT check `res.ok` — callers split: `if (!res) return EMPTY_RESULT; if (!res.ok) return EMPTY_RESULT;` then read via `readJson()`.
- `buildHeaders()` does NOT include Content-Type. Add locally when needed (e.g., Ollama POST needs `Content-Type: application/json`, but GET does not).
- `ProbeContext.signal` carries the config-hook abort signal. New probes and
  probes that add external I/O should pass it to `probeFetch`. Actualyze does this;
  legacy probes still rely on `probeFetch` and body-read timeouts.
- Outer try-catch must stay even after switching to `probeFetch` — parsing can still throw on malformed bodies.

## Server Quirks

- `owned_by` is optional (`owned_by?: string`). Some servers omit it entirely. Missing is not a positive signal for any server.
- Actualyze is the Tier 1 mixed-catalog exception: any exact `owned_by: "atlas"`
  selects Actualyze. Auto mode details only that owner subset; explicit Actualyze mode
  retains all-safe-ID behavior. Keep the fingerprint and probe predicates
  identical and case-sensitive.
- KoboldCpp `jinja: true` does NOT mean tool calling support. Do not infer `toolCall` from Jinja.
- `llamacpp` and `localai` both map to the `ollama` probe via `PROBE_MAP` — llama.cpp implements Ollama-compatible API endpoints.

## Fingerprinting

- Tier 1 (modelsResponse inspection) makes zero HTTP calls and has no timer.
- Non-Actualyze `owned_by` fingerprints require unanimous ownership. Check the
  exact Actualyze exception before that rule and before llama.cpp field detection.
- The `globalTimeout` timer is created after Tier 1. Early returns from Tier 1 never create it — no leak.
- `combinedSignal` composes the caller's abort signal with the fingerprint's own controller. Built once, reused across Tier 2/3 probes.
- Abort checks (`if (combinedSignal.aborted) return undefined`) are placed between each Tier 2/3 step for fast exit.

## Files That Change Together

Adding a new probe requires changes in all of these:

1. `src/probes/yourserver.ts` — probe implementation
2. `src/probes/index.ts` — add to `PROBES` registry
3. `src/probes/fingerprint.ts` — add to `DetectedServer` type, `ProbeKey` type, `PROBE_MAP`, and add tier detection logic
4. `test/probes/yourserver.test.ts` — tests
5. `README.md` — Supported Servers table
