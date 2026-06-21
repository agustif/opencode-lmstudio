# Debugging

## Inspect OpenCode's resolved configuration

Use OpenCode's parser to inspect the exact configuration loaded by the CLI:

```sh
npm run validate:config -- /path/to/opencode.json
# or
OPENCODE_CONFIG=/path/to/opencode.json opencode debug config
```

Confirm that `provider.lmstudio.options.baseURL`, discovered models, limits,
modalities, and whitelist match the intended LM Studio server.

## Inspect LM Studio metadata

For a local server:

```sh
curl --fail --silent http://127.0.0.1:1234/api/v0/models | jq .
```

For a server requiring a Bearer token:

```sh
curl --fail --silent \
  -H "Authorization: Bearer $LMSTUDIO_API_KEY" \
  http://127.0.0.1:1234/api/v0/models | jq .
```

Chat discovery uses models with a non-empty `id` and a `type` of `llm` or
`vlm`. A positive `max_context_length` becomes the OpenCode context limit.

## Inspect OpenCode logs

Filter OpenCode logs for the service name `opencode-lmstudio`:

- `info`: discovery completed and reports model counts;
- `warn`: an explicitly configured LM Studio server could not be reached or
  returned an unsupported response; and
- `debug`: local auto-detection found no available LM Studio server.

Sanitize configuration and logs before sharing them. Remove API keys, Bearer
tokens, private model paths, and unrelated environment values.

## Run repository checks

```sh
npm run validate
npm run test:coverage
npm run smoke:opencode
npm run test:tui:check
npm audit
npm pack --dry-run
```

Failed TUI runs retain replayable traces under `tui-traces/`. Package previews
should contain `LICENSE`, `README.md`, `package.json`, and the current `dist/`
build only.

To exercise an immutable npm version through the real OpenCode smoke and TUI
matrix:

```sh
npm run smoke:opencode:package -- opencode-lmstudio@1.0.0-rc.1
npm run test:tui:package -- opencode-lmstudio@1.0.0-rc.1
```

Package-mode screenshots are written under `tui-artifacts/npm-<version>/`.
