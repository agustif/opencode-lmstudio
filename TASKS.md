# Architecture and improvement DAG

This task graph replaces the pre-1.0 plan. The old plan proposed loaded-model
guards, name-based inference, polling, and telemetry that conflict with LM Studio
JIT loading and OpenCode's current plugin architecture.

## 1.0 release graph

| Node | Depends on | Status | Acceptance evidence |
|---|---|---|---|
| Typed LM Studio discovery | — | done | Runtime-validated `/api/v0/models`; no `/v1/models` fallback or model-name inference |
| Typed OpenCode config mapping | Typed discovery | done | Config-hook types derived from `@opencode-ai/plugin`; embeddings skipped; VLM attachments mapped |
| Authentication boundary | Typed discovery | done | Explicit tokens and `{env:...}` supported; fallback tokens restricted to private/local URLs |
| JIT-safe request behavior | Typed config mapping | done | No `chat.params` loaded-model guard, polling, or request interception |
| Unit and package validation | Typed config mapping | done | Strict typecheck, lint, Vitest coverage thresholds, clean `dist`, audit, tarball import |
| Real OpenCode CLI smoke | Unit and package validation | done | Latest pinned OpenCode resolves config and sends an authenticated chat request through the fixture |
| OpenCode TUI evidence | Realistic fixture | done | Microsoft TUI Test covers selected model and model dialog; deterministic SVG screenshots |
| Realistic deterministic fixture | Typed discovery | done | Sanitized fixture captured from local LM Studio; refresh scripts support `lms` and live API sources |
| CI and release gates | All validation nodes | done | Quality, latest CLI smoke, pinned TUI, dependency review, manual release workflow |
| 1.0 release notes and credits | CI and release gates | done | Changelog, curated notes, migration guidance, contributor acknowledgements |
| PR disposition | 1.0 implementation | next | Every open PR receives an accurate merge/close/hold outcome and contributor credit |
| 1.0 publish | PR disposition | blocked on approval | Explicit approval, green CI, reviewed main commit, dry-run release evidence |

## Post-1.0 follow-up graph

| Node | Depends on | Status | Acceptance criteria |
|---|---|---|---|
| Multiple named LM Studio providers | Stable 1.0 provider contract | proposed; track with PR #10 | Explicit configuration contract; no provider-name regex guessing; isolated auth and discovery per host |
| Latest OpenTUI native TUI Test handshake | Upstream Microsoft/OpenTUI support | proposed | Remove pinned TUI compatibility version and retries after current OpenCode renders reliably in `@microsoft/tui-test` |
| Official output-limit metadata | LM Studio API exposes the field | proposed | Replace bounded output reserve with an official typed field without reducing usable context |
| Rich official display names | LM Studio REST exposes display name | proposed | Use official display name; never infer formatting from model IDs |
| Official provider registration hook | OpenCode supports dynamic custom providers through provider hooks | proposed | Replace config mutation only when OpenCode can register the custom `lmstudio` provider directly |

## Explicit non-goals

- Model-family substring registries or model-name capability guessing
- Treating embedding models as chat models
- Blocking LM Studio JIT loading because a model is not already loaded
- Per-request polling, stale in-memory model caches, startup toasts, or hidden telemetry
- Automatic releases that bump, commit, push, tag, and publish without a reviewed approval gate
