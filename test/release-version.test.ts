import { describe, expect, it } from "vitest"
import { getReleaseVersionMetadata } from "../scripts/release-version.ts"

describe("release version metadata", () => {
  it("routes a stable release to npm latest and GitHub latest", () => {
    expect(getReleaseVersionMetadata("1.0.0")).toEqual({
      version: "1.0.0",
      gitTag: "v1.0.0",
      npmTag: "latest",
      isPrerelease: false,
      githubLatest: true,
    })
  })

  it("routes a release candidate to npm next and a GitHub prerelease", () => {
    expect(getReleaseVersionMetadata("1.0.0-rc.1")).toEqual({
      version: "1.0.0-rc.1",
      gitTag: "v1.0.0-rc.1",
      npmTag: "next",
      isPrerelease: true,
      githubLatest: false,
    })
  })

  it("supports other valid prerelease identifiers on the next channel", () => {
    expect(getReleaseVersionMetadata("2.3.4-beta.2").npmTag).toBe("next")
    expect(getReleaseVersionMetadata("2.3.4-rc1").isPrerelease).toBe(true)
  })

  it.each([
    "1-rc1",
    "v1.0.0",
    "01.0.0",
    "1.0.0-rc.01",
    "1.0.0+build.1",
    "1.0.0\noutput=injected",
  ])("rejects invalid or release-unsafe version %j", (version) => {
    expect(() => getReleaseVersionMetadata(version)).toThrow("Expected an exact SemVer release")
  })
})
