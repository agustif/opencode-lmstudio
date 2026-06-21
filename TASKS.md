# Roadmap

## v1 release candidate

| Workstream | Status | Acceptance evidence |
| --- | --- | --- |
| Typed LM Studio discovery | done | Runtime-validated `/api/v0/models` metadata |
| OpenCode model mapping | done | LLM, VLM, embedding, context, and attachment behavior covered by tests |
| Authentication | done | Explicit and environment-referenced tokens covered across local/private and configured hosts |
| On-demand loading | done | Downloaded models remain eligible for LM Studio JIT loading |
| Unit and package validation | done | Typecheck, lint, coverage, audit, clean build, and tarball import |
| Real OpenCode CLI smoke | done | Config resolution, discovery, auth, model selection, and chat request |
| OpenCode TUI evidence | done | Selected-model and model-dialog coverage with deterministic screenshots |
| CI and release automation | done | Quality, smoke, TUI, dependency review, RC channels, and OIDC publishing |
| RC documentation and feedback | active | Release notes, opt-in guide, and canonical tracker in issue #34 |
| `1.0.0-rc.1` publication | active | npm `next`, GitHub prerelease, public artifact verification |
| Final `1.0.0` | pending RC feedback | Release blockers resolved and compatibility guidance confirmed |

## Follow-up work

| Workstream | Tracking | Acceptance criteria |
| --- | --- | --- |
| Multiple named LM Studio providers | PR #10 | Explicit provider contract with isolated auth and discovery per host |
| Current OpenCode TUI handshake | upstream Microsoft/OpenTUI support | Current OpenCode renders reliably in `@microsoft/tui-test` |
| Official output-limit metadata | LM Studio API | Use the reported output field when it becomes available |
| Rich display names | LM Studio API | Use the official display name while preserving model IDs |
| Provider registration hook | OpenCode API | Register the `lmstudio` provider through an official dynamic-provider hook |

## Design constraints

- LM Studio metadata is the source for model type and context limits.
- OpenCode's chat provider receives generative `llm` and `vlm` models.
- LM Studio owns model loading and request execution.
- Explicit user configuration takes precedence over discovered metadata.
- Releases require a reviewed commit, green gates, explicit approval, and
  verified public artifacts.
