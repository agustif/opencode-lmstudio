# Debugging

## Inspect OpenCode's resolved configuration

Use OpenCode's own current parser rather than a local approximation:

```sh
npm run validate:config -- /path/to/opencode.json
# or
OPENCODE_CONFIG=/path/to/opencode.json opencode debug config
```

## Confirm LM Studio metadata

For a local server without authentication:

```sh
curl --fail --silent http://127.0.0.1:1234/api/v0/models | jq .
```

For a server requiring a Bearer token:

```sh
curl --fail --silent \
  -H "Authorization: Bearer $LMSTUDIO_API_KEY" \
  http://127.0.0.1:1234/api/v0/models | jq .
```

A discoverable generative model must have a non-empty `id`, a `type` of `llm`
or `vlm`, and may include a positive `max_context_length`. Embedding and unknown
model domains are intentionally not added to OpenCode's chat provider.

## Structured logs

The plugin writes through OpenCode's `client.app.log` service. It does not print
directly to `console` or send startup toasts. Look for the service name
`opencode-lmstudio` in OpenCode logs.

- `info`: discovery succeeded
- `warn`: an explicitly configured LM Studio server could not be discovered
- `debug`: no auto-detected local LM Studio server was available

## Repository checks

```sh
npm run validate
npm run test:coverage
npm run smoke:opencode
npm run test:tui
npm audit
npm pack --dry-run
```

The TUI suite uses `@microsoft/tui-test`, not sleeps or pane scraping. Failed
runs retain replayable traces under `tui-traces/`.

The build cleans `dist/` before compiling. If a package preview contains deleted
modules, treat it as a build failure and do not release.
