import { describe, expect, it } from "vite-plus/test";

import {
  CLI_RELEASE_BASE_URL_ENV,
  CLI_RELEASE_REPOSITORY_ENV,
  cliReleaseAssetUrl,
  cliReleaseDownloadBaseUrl,
  cliReleaseIndexPageUrl,
  cliReleaseRepository,
  cliReleasesPageUrl,
  cliArchiveTarCommand,
  newestCliReleaseVersion,
  parseChecksums,
} from "./cliRelease.ts";

describe("cliRelease", () => {
  it("defaults the release repository and feed URLs to smartphonekey/t3code", () => {
    expect(cliReleaseRepository({})).toBe("smartphonekey/t3code");
    expect(cliReleasesPageUrl({})).toBe("https://github.com/smartphonekey/t3code/releases");
    expect(cliReleaseIndexPageUrl(2, {})).toBe(
      "https://api.github.com/repos/smartphonekey/t3code/releases?per_page=100&page=2",
    );
    expect(cliReleaseDownloadBaseUrl("1.2.3", undefined, {})).toBe(
      "https://github.com/smartphonekey/t3code/releases/download/v1.2.3",
    );
    expect(cliReleaseAssetUrl("1.2.3", "SHA256SUMS", undefined, {})).toBe(
      "https://github.com/smartphonekey/t3code/releases/download/v1.2.3/SHA256SUMS",
    );
  });

  it("honors T3CODE_RELEASE_REPOSITORY and keeps T3CODE_RELEASE_BASE_URL as the download override", () => {
    const env = {
      [CLI_RELEASE_REPOSITORY_ENV]: "acme/t3code",
    };
    expect(cliReleaseRepository(env)).toBe("acme/t3code");
    expect(cliReleaseIndexPageUrl(1, env)).toContain("/repos/acme/t3code/releases");
    expect(cliReleaseDownloadBaseUrl("0.0.1", undefined, env)).toBe(
      "https://github.com/acme/t3code/releases/download/v0.0.1",
    );
    const mirrorEnv = {
      ...env,
      [CLI_RELEASE_BASE_URL_ENV]: "https://mirror.example/t3code/releases/download",
    };
    expect(cliReleaseDownloadBaseUrl("0.0.1", undefined, mirrorEnv)).toBe(
      "https://mirror.example/t3code/releases/download/v0.0.1",
    );
    expect(cliReleaseAssetUrl("0.0.1", "t3-0.0.1-linux-x64.tar.gz", undefined, mirrorEnv)).toBe(
      "https://mirror.example/t3code/releases/download/v0.0.1/t3-0.0.1-linux-x64.tar.gz",
    );
    expect(cliReleaseIndexPageUrl(1, mirrorEnv)).toContain("/repos/acme/t3code/releases");
  });

  it("parses sha256sum output including binary-mode markers", () => {
    const checksums = parseChecksums(
      [
        `${"a".repeat(64)}  t3-1.2.3-linux-x64.tar.gz`,
        `${"B".repeat(64)} *t3-1.2.3-win32-x64.zip`,
        "not a checksum line",
        "",
      ].join("\n"),
    );
    expect(checksums.get("t3-1.2.3-linux-x64.tar.gz")).toBe("a".repeat(64));
    expect(checksums.get("t3-1.2.3-win32-x64.zip")).toBe("b".repeat(64));
    expect(checksums.size).toBe(2);
  });

  it("extracts with the System32 bsdtar on Windows and plain tar elsewhere", () => {
    expect(cliArchiveTarCommand("linux", {})).toBe("tar");
    expect(cliArchiveTarCommand("win32", { SystemRoot: "D:\\Win" })).toBe(
      "D:\\Win\\System32\\tar.exe",
    );
    expect(cliArchiveTarCommand("win32", {})).toBe("C:\\Windows\\System32\\tar.exe");
  });

  it("picks the newest non-draft release on the requested channel", () => {
    const releases = [
      { tag_name: "v1.2.4-preview.20260912.9", draft: true },
      { tag_name: "v1.2.4-preview.20260912.8" },
      { tag_name: "v1.2.4-nightly.20260912.7" },
      { tag_name: "desktop-preview" },
      { tag_name: "v1.2.3" },
      { tag_name: "v1.2.3-nightly.20260911.2" },
    ];
    expect(newestCliReleaseVersion(releases, "preview")).toBe("1.2.4-preview.20260912.8");
    expect(newestCliReleaseVersion(releases, "nightly")).toBe("1.2.4-nightly.20260912.7");
    expect(newestCliReleaseVersion(releases, "stable")).toBe("1.2.3");
    expect(newestCliReleaseVersion([{ tag_name: "v1.2.3" }], "preview")).toBeUndefined();
  });
});
