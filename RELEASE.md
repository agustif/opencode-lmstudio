# Release runbook

Release actions begin after the candidate gate passes and the exact mutation is
explicitly approved.

## Release channels

| Package version | npm dist-tag | GitHub release | Stable `latest` |
| --- | --- | --- | --- |
| `x.y.z` | `latest` | Full release, marked latest | Moves to `x.y.z` |
| `x.y.z-<prerelease>` | `next` | Prerelease | Remains on current stable |

`scripts/release-version.ts` is the executable channel contract. It accepts an
exact SemVer version without build metadata, emits the Git tag and release
channel, and is covered by unit tests. Release commands use its output directly.

The first typed-discovery candidate is `1.0.0-rc.1`. Its canonical opt-in,
rollback, test matrix, and feedback tracker is
[#34](https://github.com/agustif/opencode-lmstudio/issues/34).

## Release gate

Before proposing a release:

1. Review every open PR and record a merge, close, or hold recommendation.
2. Confirm the feature-parity matrix and intentional compatibility changes.
3. Confirm `package.json`, `package-lock.json`, and
   `docs/releases/v<version>.md` name the exact candidate.
4. Run `npm run release:check`.
5. Confirm the real OpenCode CLI smoke and every plugin-facing Microsoft TUI
   Test view pass from both the source build and packed candidate.
6. Confirm `npm audit` reports no vulnerabilities.
7. Confirm `npm pack --dry-run` contains only current build artifacts.
8. Test the packed tarball in a clean temporary project.
9. Verify the worktree and branch are exactly the reviewed revision.
10. For prereleases, verify npm `latest` points to the current stable version.
11. Show the user the evidence and exact commands that will mutate GitHub/npm.
12. Wait for explicit approval before any commit, push, tag, GitHub release, or
    npm publish action.

## Local preflight

```sh
npm run release:check
npm run smoke:opencode
npm run test:tui:check
```

The preflight is intentionally non-releasing. It validates the version/channel
contract and release-notes file, then runs validation, coverage, security audit,
and package preview. The OpenCode smoke and TUI screenshot checks remain
separate explicit gates locally and in CI.

## npm trusted publisher

The release workflow uses GitHub OIDC and npm provenance. The package must have
exactly one trusted publisher matching this repository, workflow, and GitHub
environment:

```sh
npx --yes npm@11.16.0 trust list opencode-lmstudio
npx --yes npm@11.16.0 trust github opencode-lmstudio \
  --file release.yml \
  --repository agustif/opencode-lmstudio \
  --environment release \
  --allow-publish
```

Configuring trust requires npm package-owner authentication and 2FA. CI
authentication is OIDC-only. Use npm `11.16.0` or newer so the trust command
includes the registry's required explicit publish permission.

## Release workflow

The manual GitHub Actions workflow is the canonical mutation path. It defaults
to validation-only.

Validation-only run:

```sh
gh workflow run release.yml \
  --ref main \
  -f version=<version> \
  -f publish=false
```

Approved publication run:

```sh
gh workflow run release.yml \
  --ref main \
  -f version=<version> \
  -f publish=true
```

For every candidate the workflow:

1. validates exact SemVer, manifest version, release notes, branch, and clean tree;
2. runs core, OpenCode smoke, all TUI views, audit, and package gates;
3. installs the packed candidate and repeats the real OpenCode smoke and TUI
   matrix before publication;
4. stages a draft GitHub release, marking prereleases before publication;
5. publishes with npm provenance to derived tag `next` or `latest`;
6. verifies that the derived npm tag resolves to the exact version and stable
   `latest` remains unchanged for a prerelease;
7. anonymously installs the exact public npm version and repeats the real
   OpenCode smoke and every TUI view; and
8. finalizes the GitHub prerelease or full latest release.

If npm publication fails, the workflow removes the staged draft release and
tag. If npm succeeds but later verification fails, preserve the draft and
published package for explicit reconciliation; npm versions are immutable.

## Post-release verification

```sh
npm view opencode-lmstudio dist-tags --json
npm view opencode-lmstudio@<version> version dist.tarball dist.integrity --json
gh release view "v<version>" --json tagName,isDraft,isPrerelease,url
git status --short --branch
```

For a prerelease, also prove that `opencode-lmstudio@next` resolves to the
candidate and `opencode-lmstudio@latest` still resolves to the current stable
version. Download the registry tarball, inspect it, and install/import it in a
clean temporary project before calling the release complete.

Update the canonical feedback tracker with immutable npm and GitHub links after
publication. Publish final `1.0.0` as a separate immutable version after RC
feedback is triaged.
