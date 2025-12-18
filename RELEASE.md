# Release Process

This project uses an automated release system that handles versioning, testing, git tagging, GitHub releases, and npm publishing.

## Quick Start

```bash
npm run release patch   # 0.1.0 -> 0.1.1 (bug fixes)
npm run release minor   # 0.1.0 -> 0.2.0 (new features)
npm run release major   # 0.1.0 -> 1.0.0 (breaking changes)
npm run release 0.2.0   # Set specific version
```

## What the Release Script Does

1. **Bumps version** in `package.json`
2. **Runs build and tests** to ensure everything works
3. **Creates git tag** (e.g., `v0.1.1`)
4. **Pushes to GitHub** (commits and tags)
5. **Creates GitHub release** with auto-generated release notes
6. **Publishes to npm** (if authentication is configured)

## Prerequisites

### Local Releases

1. **npm authentication** (one of these):
   - `npm login` (with 2FA OTP)
   - `npm token create --read-only=false` then `npm config set //registry.npmjs.org/:_authToken YOUR_TOKEN`
   - Set `NPM_TOKEN` environment variable

2. **GitHub CLI** (`gh`) authenticated:
   - `gh auth login`

### CI/CD Releases (GitHub Actions)

1. Add `NPM_TOKEN` secret to your GitHub repository:
   - Go to: Settings → Secrets and variables → Actions
   - Add secret: `NPM_TOKEN` = (your npm token)

2. Run the workflow:
   - Go to: Actions → Release → Run workflow
   - Select version type (patch/minor/major)
   - Click "Run workflow"

## Version Types

- **patch**: Bug fixes, small improvements (0.1.0 → 0.1.1)
- **minor**: New features, backwards compatible (0.1.0 → 0.2.0)
- **major**: Breaking changes (0.1.0 → 1.0.0)

## Manual Steps (if needed)

If the automated script fails at any step, you can complete it manually:

```bash
# 1. Bump version
npm version patch  # or minor, major

# 2. Run tests
npm run build

# 3. Create and push tag
git tag v0.1.1
git push origin v0.1.1

# 4. Create GitHub release
gh release create v0.1.1 --title "v0.1.1" --notes "Release notes"

# 5. Publish to npm
npm publish
```

## Troubleshooting

### npm publish fails with 2FA error

**Solution**: Create an npm token and configure it:
```bash
npm token create --read-only=false
npm config set //registry.npmjs.org/:_authToken YOUR_TOKEN
```

Or use environment variable:
```bash
export NPM_TOKEN=your_token_here
npm run release patch
```

### GitHub release creation fails

**Solution**: Ensure GitHub CLI is authenticated:
```bash
gh auth login
```

### Version already exists

**Solution**: The script will detect this and skip npm publish. Just bump to the next version:
```bash
npm run release patch  # Will create 0.1.2 if 0.1.1 exists
```

## CI/CD Integration

The GitHub Actions workflow (`.github/workflows/release.yml`) allows you to create releases from the GitHub UI:

1. Go to Actions tab
2. Select "Release" workflow
3. Click "Run workflow"
4. Choose version type
5. Click "Run workflow" button

The workflow will:
- Run all tests
- Create git tag
- Create GitHub release
- Publish to npm

All automatically! 🚀

