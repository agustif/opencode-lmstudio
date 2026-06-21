import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { getReleaseVersionMetadata } from "./release-version.ts"

const packageName = "opencode-lmstudio"

export interface InstalledTestPackage {
  readonly entrypoint: string
  readonly source: "npm" | "tarball"
  readonly version: string
}

export function expectedVersionForPackageSpec(spec: string, explicitVersion?: string): string {
  const npmPrefix = `${packageName}@`
  const inferred = spec.startsWith(npmPrefix) ? spec.slice(npmPrefix.length) : undefined
  const version = explicitVersion ?? inferred
  if (!version) throw new Error("A tarball package test requires --expected-version")
  getReleaseVersionMetadata(version)
  return version
}

export function installTestPackage(
  spec: string,
  expectedVersion: string,
  installRoot: string,
): InstalledTestPackage {
  const source = spec.startsWith(`${packageName}@`) ? "npm" : "tarball"
  const installSpec = source === "tarball" ? resolve(spec) : spec
  if (source === "tarball" && !existsSync(installSpec)) {
    throw new Error(`Package tarball does not exist: ${installSpec}`)
  }

  mkdirSync(installRoot, { recursive: true })
  const npmrc = join(installRoot, "anonymous.npmrc")
  writeFileSync(npmrc, "registry=https://registry.npmjs.org\nalways-auth=false\n")
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      key !== "NODE_AUTH_TOKEN"
      && key !== "NPM_TOKEN"
      && !(key.toLowerCase().startsWith("npm_config_") && /(auth|token)/i.test(key))),
  )
  env.NPM_CONFIG_USERCONFIG = npmrc

  const result = spawnSync("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    "--prefer-online",
    "--prefix",
    installRoot,
    installSpec,
  ], { encoding: "utf8", env })
  if (result.status !== 0) {
    throw new Error(`Could not install ${spec}:\n${result.stderr || result.stdout}`)
  }

  const packageRoot = join(installRoot, "node_modules", packageName)
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
    version?: string
  }
  if (manifest.version !== expectedVersion) {
    throw new Error(`Expected ${packageName}@${expectedVersion}, installed ${manifest.version ?? "unknown"}`)
  }

  const entrypoint = join(packageRoot, "dist", "index.js")
  if (!existsSync(entrypoint)) throw new Error(`Installed package is missing ${entrypoint}`)
  return { entrypoint, source, version: expectedVersion }
}
