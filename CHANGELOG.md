# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0-rc.2] - 2026-06-21

### Added

- Runtime validation for LM Studio's native `GET /api/v1/models` schema.
- Effective context tests for unloaded, singly loaded, and multiply loaded
  model instances.
- Issue-shaped Nemotron, GLM vision, authentication, changing-model-list,
  embedding, and context regressions.
- A real OpenCode ACP SDK gate for initialization, session creation, and
  newline-delimited JSON-RPC stdout purity.
- A clean HOME/XDG test for OpenCode's native npm-plugin resolver and cache.
- Fixture provenance and a documented v1 endpoint/mapping contract.

### Changed

- The v1 line now requires LM Studio 0.4.0 or newer and OpenCode 1.17.7 or
  newer.
- Discovery uses only native `/api/v1/models`; OpenAI-compatible
  `/v1/chat/completions` remains the inference boundary.
- Model `key` and `display_name` replace v0 IDs and name heuristics.
- Vision support comes from `capabilities.vision`.
- Loaded models use their configured instance context. Multiple active
  instances use the conservative minimum; unloaded models use the model
  maximum.
- Automatic discovery checks only LM Studio's documented default port. Custom
  ports remain explicit provider configuration.
- The pinned TUI compatibility gate now runs the supported OpenCode 1.17.7
  minimum, while current CLI/ACP checks run 1.17.9.

### Fixed

- Generated model entries and whitelists no longer retain IDs removed by a
  later LM Studio configuration load.
- Loaded and unloaded embedding records remain outside the chat provider.
- HTTP-200 error objects are rejected as unsupported native responses.
- A false `trained_for_tool_use` value no longer risks being interpreted as a
  reason to disable OpenCode tools.

### Compatibility notes

- Stable `0.3.1` remains available for earlier installations.
- `trained_for_tool_use` and LM Studio reasoning settings are not translated
  into non-equivalent OpenCode fields. See `docs/v1-contract.md`.
- The prerelease remains on npm `next`; stable npm `latest` remains `0.3.1`.

## [1.0.0-rc.1] - 2026-06-21

### Added

- Runtime-validated LM Studio `/api/v0/models` discovery using an explicit typed boundary.
- Official model-type-driven chat, vision, embedding filtering, and context metadata.
- Structured OpenCode logging through `client.app.log`.
- Real OpenCode CLI smoke coverage and Microsoft TUI Test end-to-end coverage.
- Deterministic, generated terminal screenshots for README and release evidence.
- Release preflight, clean package inspection, and dependency audit gates.

### Changed

- Model discovery uses LM Studio's reported model type and metadata.
- User model overrides and explicit whitelists take precedence over discovery.
- Context-aware models use LM Studio's reported context length and a bounded
  output reserve so OpenCode compaction retains a usable prompt budget.
- Auto-detection accepts a port only after its LM Studio metadata response validates.
- Package builds contain a fresh `dist/` tree generated from current source.
- OpenCode configuration validation delegates to OpenCode's own parser.

### Fixed

- Embedding models remain outside OpenCode's chat-model configuration.
- Explicit and private-network API-key authentication applies during discovery.
- Vision models receive the OpenCode attachment capability only when LM Studio reports `vlm`.
- Downloaded models remain eligible for LM Studio JIT loading.

### Release-candidate scope

The proposed 1.0.0 release defines a typed integration contract between LM
Studio's REST metadata and OpenCode's config hook. This first candidate is
published under npm `next`; stable npm `latest` remains on `0.3.1` while
community feedback is collected in
[#34](https://github.com/agustif/opencode-lmstudio/issues/34).

### Migration notes

- LM Studio 0.3.6 or newer is required for `/api/v0/models` discovery.
- Model discovery uses `GET /api/v0/models`.
- Model IDs are preserved exactly.
- OpenCode's chat provider includes `llm` and `vlm` model types.
- Users needing a custom display name, output limit, or whitelist should configure an explicit model override.
- Final `1.0.0` will not occur until RC feedback is triaged and CI,
  current-OpenCode smoke tests, pinned screenshot tests, package inspection,
  PR disposition, and explicit approval are complete.

### Acknowledgements

- Community co-authors: [@trigger2k20](https://github.com/trigger2k20),
  [@aluzed](https://github.com/aluzed),
  [@rashomon-gh](https://github.com/rashomon-gh),
  [@scott1028](https://github.com/scott1028),
  [@SerenityG4K](https://github.com/SerenityG4K),
  [@Lzmatgh](https://github.com/Lzmatgh),
  [@HarelMil](https://github.com/HarelMil), and
  [@jleaders](https://github.com/jleaders).
- Additional testing and design input:
  [@z3r0-815](https://github.com/z3r0-815) and
  [@bluelovers](https://github.com/bluelovers).
- Contribution details and pull-request links are recorded in
  [`CONTRIBUTORS.md`](./CONTRIBUTORS.md).

[Unreleased]: https://github.com/agustif/opencode-lmstudio/compare/v1.0.0-rc.2...HEAD
[1.0.0-rc.2]: https://github.com/agustif/opencode-lmstudio/compare/v1.0.0-rc.1...v1.0.0-rc.2
[1.0.0-rc.1]: https://github.com/agustif/opencode-lmstudio/compare/v0.3.1...v1.0.0-rc.1
