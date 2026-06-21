import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { createServer } from "node:http"
import { readFileSync } from "node:fs"
import { basename, resolve } from "node:path"

interface PackageManifest {
  readonly name: string
  readonly version: string
  readonly [key: string]: unknown
}

export interface NpmRegistryFixture {
  readonly registryURL: string
  close(): Promise<void>
}

function readManifest(tarball: string): PackageManifest {
  const result = spawnSync("tar", ["-xOf", tarball, "package/package.json"], { encoding: "utf8" })
  if (result.status !== 0) throw new Error(result.stderr || "Could not inspect package tarball")
  const manifest = JSON.parse(result.stdout) as Partial<PackageManifest>
  if (!manifest.name || !manifest.version) throw new Error("Package tarball manifest is missing name or version")
  return manifest as PackageManifest
}

/**
 * Serve one candidate package locally and proxy all dependency reads to npm.
 * This gives OpenCode's real Arborist resolver an npm registry contract before
 * the immutable candidate is public.
 */
export async function createNpmRegistryFixture(tarballInput: string): Promise<NpmRegistryFixture> {
  const tarball = resolve(tarballInput)
  const archive = readFileSync(tarball)
  const manifest = readManifest(tarball)
  const tarballName = basename(tarball)
  let registryURL = ""
  const server = createServer(async (request, response) => {
    try {
      const requestURL = new URL(request.url ?? "/", registryURL)
      const packagePath = `/${encodeURIComponent(manifest.name)}`
      if (request.method === "GET" && requestURL.pathname === packagePath) {
        const shasum = createHash("sha1").update(archive).digest("hex")
        const integrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`
        const version = {
          ...manifest,
          _id: `${manifest.name}@${manifest.version}`,
          dist: {
            integrity,
            shasum,
            tarball: `${registryURL}/${manifest.name}/-/${tarballName}`,
          },
        }
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({
          name: manifest.name,
          "dist-tags": { latest: manifest.version, next: manifest.version },
          versions: { [manifest.version]: version },
        }))
        return
      }
      if (request.method === "GET" && requestURL.pathname === `/${manifest.name}/-/${tarballName}`) {
        response.writeHead(200, {
          "content-length": archive.length,
          "content-type": "application/octet-stream",
        })
        response.end(archive)
        return
      }

      const upstream = new URL(request.url ?? "/", "https://registry.npmjs.org")
      const upstreamResponse = await fetch(upstream, {
        headers: request.headers.accept ? { accept: request.headers.accept } : undefined,
        method: request.method,
      })
      const body = Buffer.from(await upstreamResponse.arrayBuffer())
      response.writeHead(upstreamResponse.status, {
        "content-length": body.length,
        "content-type": upstreamResponse.headers.get("content-type") ?? "application/octet-stream",
      })
      response.end(body)
    } catch (error) {
      response.writeHead(502, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    }
  })

  const port = await new Promise<number>((resolvePort, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") return reject(new Error("Could not allocate registry port"))
      resolvePort(address.port)
    })
  })
  registryURL = `http://127.0.0.1:${port}`

  return {
    registryURL,
    close: async () => {
      server.close()
      server.closeAllConnections()
    },
  }
}
