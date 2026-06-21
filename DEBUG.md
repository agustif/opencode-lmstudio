# Debugging

## Inspect OpenCode's resolved configuration

Use OpenCode's parser to inspect the exact configuration loaded by the CLI:

```sh
npm run validate:config -- /path/to/opencode.json
# or
OPENCODE_CONFIG=/path/to/opencode.json opencode debug config
```

Check `provider.lmstudio.options.baseURL`, models, limits, modalities, and the
whitelist. OpenCode should report at least version 1.17.7:

```sh
opencode --version
```

## Inspect native LM Studio metadata

For the documented default server:

```sh
curl --fail --silent http://127.0.0.1:1234/api/v1/models | jq .
```

For a server requiring an API token:

```sh
curl --fail --silent \
  -H "Authorization: Bearer $LM_API_TOKEN" \
  http://127.0.0.1:1234/api/v1/models | jq .
```

Each discovered chat model requires a non-empty `key`, `display_name`,
`type: "llm"`, positive `max_context_length`, and the documented loaded-instance
shape. `capabilities.vision` controls image input. Embedding records are
excluded. When instances are loaded, compare their `config.context_length`
values with the resolved OpenCode `limit.context`.

An HTTP 200 alone does not prove endpoint compatibility: LM Studio can return
an error object with that status for an unknown endpoint. The plugin validates
the full native response shape and logs an unsupported-response warning for an
invalid configured server.

## Inspect OpenCode logs

Filter OpenCode logs for `opencode-lmstudio`:

- `info`: native discovery completed, including model counts and
  `discoveryPath: "/api/v1/models"`;
- `warn`: an explicitly configured server failed or returned an unsupported
  response; and
- `debug`: the documented default local endpoint was unavailable.

Logs do not include tokens or response bodies. Sanitize any configuration and
surrounding logs before sharing them; remove API keys, Bearer tokens, private
model paths, private hostnames, and unrelated environment values.

## Run repository checks

```sh
npm run validate
npm run test:coverage
npm run smoke:opencode
npm run smoke:opencode:acp
npm run test:tui:check
npm audit
npm pack --dry-run
```

Failed TUI runs retain replayable traces under `tui-traces/`. Package previews
should contain `LICENSE`, `README.md`, `package.json`, and the current `dist/`
build only.

## Test an immutable public package

Run all three external loading boundaries against an exact npm version:

```sh
npm run smoke:opencode:package -- opencode-lmstudio@1.0.0-rc.2
npm run smoke:opencode:resolver -- opencode-lmstudio@1.0.0-rc.2
npm run smoke:opencode:acp:package -- opencode-lmstudio@1.0.0-rc.2
npm run test:tui:package -- opencode-lmstudio@1.0.0-rc.2
```

The package smoke installs with npm and uses a local plugin entrypoint. The
resolver smoke instead gives the package spec directly to OpenCode in a clean
HOME/XDG environment, checks OpenCode's package cache and configured origin,
then performs discovery and chat. The ACP gate initializes and creates a
session using SDK 0.21.0 while requiring every stdout line to be JSON-RPC.

Package-mode screenshots are written under `tui-artifacts/npm-<version>/`.
See [the v1 integration contract](./docs/v1-contract.md) for the exact external
API decisions.
