# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Runtime-validated LM Studio `/api/v0/models` discovery using an explicit typed boundary.
- Official model-type-driven chat, vision, embedding filtering, and context metadata.
- Structured OpenCode logging through `client.app.log`.
- Real OpenCode CLI smoke coverage and Microsoft TUI Test end-to-end coverage.
- Deterministic, generated terminal screenshots for README and release evidence.
- Release preflight, clean package inspection, and dependency audit gates.

### Changed

- Model discovery no longer guesses types or capabilities from model IDs.
- User model overrides and explicit whitelists take precedence over discovery.
- Context-aware models use LM Studio's reported context length and a bounded
  output reserve so OpenCode compaction retains a usable prompt budget.
- Auto-detection accepts a port only after its LM Studio metadata response validates.
- The build cleans `dist/` before compilation so deleted modules cannot ship.
- OpenCode configuration validation delegates to OpenCode's own parser.

### Fixed

- Embedding models are no longer emitted with an invalid `embedding` output modality.
- Explicit and private-network API-key authentication is retained during discovery.
- Vision models receive the OpenCode attachment capability only when LM Studio reports `vlm`.
- LM Studio JIT loading is no longer blocked by a pre-request loaded-model guard.

### Removed

- Model-family substring registries and name-based capability inference.
- Redundant caches, polling, loading monitors, startup toasts, and manual config validators.
- The unsafe release script that changed versions, committed, pushed, and published in one step.

## [1.0.0] - Unreleased

The proposed 1.0.0 release is a compatibility and correctness reset. It adopts LM Studio's rich REST metadata as the source of truth and OpenCode's typed config-hook contract as the output boundary.

### Migration notes

- LM Studio 0.3.6 or newer is required for `/api/v0/models` discovery.
- `/v1/models` is not used as a fallback because it cannot safely distinguish chat, vision, and embedding models.
- Model IDs are preserved exactly instead of being reformatted or sanitized.
- Embedding models are intentionally omitted from OpenCode's chat provider.
- Users needing a custom display name, output limit, or whitelist should configure an explicit model override.
- The release will not occur until CI, current-OpenCode smoke tests, pinned screenshot tests, package inspection, PR disposition, and explicit approval are complete.

### Acknowledgements

- Merged contribution: [@trigger2k20](https://github.com/trigger2k20) added API-key authentication in [#29](https://github.com/agustif/opencode-lmstudio/pull/29).
- The 1.0 design and implementation were informed by reports and proposals from [@aluzed](https://github.com/aluzed) [#30](https://github.com/agustif/opencode-lmstudio/pull/30), [@rashomon-gh](https://github.com/rashomon-gh) [#27](https://github.com/agustif/opencode-lmstudio/pull/27), [@scott1028](https://github.com/scott1028) [#26](https://github.com/agustif/opencode-lmstudio/pull/26), [@z3r0-815](https://github.com/z3r0-815) [#25](https://github.com/agustif/opencode-lmstudio/pull/25), [@bluelovers](https://github.com/bluelovers) [#23](https://github.com/agustif/opencode-lmstudio/pull/23), [@SerenityG4K](https://github.com/SerenityG4K) [#22](https://github.com/agustif/opencode-lmstudio/pull/22), [@Lzmatgh](https://github.com/Lzmatgh) [#18](https://github.com/agustif/opencode-lmstudio/pull/18) and [#19](https://github.com/agustif/opencode-lmstudio/pull/19), [@HarelMil](https://github.com/HarelMil) [#13](https://github.com/agustif/opencode-lmstudio/pull/13), and [@jleaders](https://github.com/jleaders) [#10](https://github.com/agustif/opencode-lmstudio/pull/10).

[Unreleased]: https://github.com/agustif/opencode-lmstudio/compare/v0.3.1...HEAD
[1.0.0]: https://github.com/agustif/opencode-lmstudio/compare/v0.3.1...v1.0.0
