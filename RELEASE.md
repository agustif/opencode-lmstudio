# Release runbook

A release is a separate, explicitly approved operation. Repository refactoring,
PR review, and validation do not authorize tagging or publishing.

## Release gate

Before proposing a release:

1. Review every open PR and record a merge, close, or hold recommendation.
2. Confirm the feature-parity matrix and intentional compatibility changes.
3. Run `npm run release:check`.
4. Confirm the real OpenCode CLI smoke and Microsoft TUI Test suite pass.
5. Confirm `npm audit` reports no vulnerabilities.
6. Confirm `npm pack --dry-run` contains only current build artifacts.
7. Test the packed tarball in a clean temporary project.
8. Verify the worktree and branch are exactly the reviewed revision.
9. Prepare release notes and the proposed semantic version.
10. Show the user the evidence and exact commands that would mutate GitHub/npm.
11. Wait for explicit approval before any commit, push, tag, GitHub release, or
    npm publish action.

## Preflight

```sh
npm run release:check
```

The preflight is intentionally non-releasing. It runs validation, security audit,
and package preview only.

## Mutating release actions

After explicit approval, perform the approved steps one at a time and verify each
result. A normal release may include:

```sh
npm version <version> --no-git-tag-version
npm run release:check
git commit -am "chore: release v<version>"
git tag -a "v<version>" -m "v<version>"
git push origin main "v<version>"
gh release create "v<version>" --verify-tag --generate-notes
npm publish --provenance --access public
```

Do not run this block blindly. Repository protection, npm trusted publishing,
and release automation may require a different approved sequence.

## Post-release verification

```sh
npm view opencode-lmstudio version dist-tags --json
gh release view "v<version>"
git status --short --branch
```

Install the released package in a clean OpenCode configuration and confirm typed
model discovery against a real LM Studio server before calling the release done.
