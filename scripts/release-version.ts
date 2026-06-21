import { pathToFileURL } from "node:url"

const releaseVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/

export interface ReleaseVersionMetadata {
  version: string
  gitTag: string
  npmTag: "latest" | "next"
  isPrerelease: boolean
  githubLatest: boolean
}

export function getReleaseVersionMetadata(version: string): ReleaseVersionMetadata {
  const match = releaseVersionPattern.exec(version)
  if (!match) {
    throw new Error(`Expected an exact SemVer release without build metadata, got: ${version}`)
  }

  const isPrerelease = match[4] !== undefined
  return {
    version,
    gitTag: `v${version}`,
    npmTag: isPrerelease ? "next" : "latest",
    isPrerelease,
    githubLatest: !isPrerelease,
  }
}

// The workflow and local release commands exercise this thin CLI wrapper.
// Unit coverage targets the pure metadata contract above.
/* v8 ignore start */
function isDirectRun(): boolean {
  const entrypoint = process.argv[1]
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href
}

if (isDirectRun()) {
  try {
    const version = process.argv[2]
    if (!version) throw new Error("A release version argument is required")

    const metadata = getReleaseVersionMetadata(version)
    console.log(`version=${metadata.version}`)
    console.log(`git_tag=${metadata.gitTag}`)
    console.log(`npm_tag=${metadata.npmTag}`)
    console.log(`is_prerelease=${metadata.isPrerelease}`)
    console.log(`github_latest=${metadata.githubLatest}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
/* v8 ignore stop */
