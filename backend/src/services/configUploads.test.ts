import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  isPromoteConfigMismatch,
  parseGeneratorVersionFromHeader,
  readGeneratorVersionFromFile,
} from "./configUploads";

describe("parseGeneratorVersionFromHeader", () => {
  it("extracts version from mc-plugin-manager comment line", () => {
    const line =
      "# mc-plugin-manager: generator-version=010; generated-at=2026-03-25T18:07:51.373Z; profile=x; plugin=aa;\n";
    expect(parseGeneratorVersionFromHeader(line)).toBe("010");
  });

  it("returns undefined when absent", () => {
    expect(parseGeneratorVersionFromHeader("foo: bar\n")).toBeUndefined();
  });
});

describe("readGeneratorVersionFromFile", () => {
  it("reads version from a yaml file on disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcsm-cfg-"));
    try {
      const path = join(dir, "config.yml");
      await writeFile(
        path,
        "# mc-plugin-manager: generator-version=999; x=y;\nTimeBook: 900\n",
        "utf8",
      );
      expect(await readGeneratorVersionFromFile(path, "plugins/X/config.yml")).toBe("999");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not read binary extensions", async () => {
    expect(await readGeneratorVersionFromFile("/nope", "region/r.0.0.mca")).toBeUndefined();
  });
});

describe("isPromoteConfigMismatch", () => {
  const base = { path: "p/a.yml", size: 1, modifiedAt: "" };

  it("is mismatch when target missing", () => {
    expect(
      isPromoteConfigMismatch({ ...base, generatorVersion: "010" }, undefined),
    ).toBe(true);
  });

  it("is mismatch when generator versions differ", () => {
    expect(
      isPromoteConfigMismatch(
        { ...base, generatorVersion: "010" },
        { ...base, generatorVersion: "008" },
      ),
    ).toBe(true);
  });

  it("is not mismatch when gen and sha256 match", () => {
    expect(
      isPromoteConfigMismatch(
        { ...base, generatorVersion: "010", sha256: "abc" },
        { ...base, generatorVersion: "010", sha256: "abc" },
      ),
    ).toBe(false);
  });
});
