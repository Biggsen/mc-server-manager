import { describe, expect, it, beforeEach } from "vitest";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { renderManifest } from "./manifestService";
import type { StoredProject } from "../types/storage";

const baseProject: StoredProject = {
  id: "test-project",
  name: "Test Project",
  description: "Example project",
  minecraftVersion: "1.21.1",
  loader: "paper",
  source: "created",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  plugins: [],
  configs: [],
};

const DATA_DIR = join(process.cwd(), "data");
const PLUGINS_STORE_PATH = join(DATA_DIR, "plugins.json");

beforeEach(async () => {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(PLUGINS_STORE_PATH, JSON.stringify({ plugins: [] }, null, 2), "utf-8");
});

describe("renderManifest repository metadata", () => {
  it("includes repository defaults when no repo is linked", async () => {
    const manifest = await renderManifest(baseProject, "build-001");
    const json = JSON.parse(manifest) as {
      repository: { url: string; fullName: string; defaultBranch: string; commit: string };
    };

    expect(json.repository.url).toBe("");
    expect(json.repository.fullName).toBe("");
    expect(json.repository.defaultBranch).toBe("main");
    expect(json.repository.commit).toBe("");
  });

  it("reflects linked repository metadata and commit information", async () => {
    const project: StoredProject = {
      ...baseProject,
      repoUrl: "https://github.com/example/server",
      defaultBranch: "main",
      repo: {
        id: 123,
        owner: "example",
        name: "server",
        fullName: "example/server",
        htmlUrl: "https://github.com/example/server",
        defaultBranch: "main",
      },
      manifest: {
        lastBuildId: "build-000",
        manifestPath: "/tmp/manifest.json",
        generatedAt: new Date().toISOString(),
        commitSha: "abc123",
      },
    };

    const manifest = await renderManifest(project, "build-002");
    const json = JSON.parse(manifest) as {
      repository: { url: string; fullName: string; defaultBranch: string; commit: string };
    };

    expect(json.repository.url).toBe("https://github.com/example/server");
    expect(json.repository.fullName).toBe("example/server");
    expect(json.repository.defaultBranch).toBe("main");
    expect(json.repository.commit).toBe("abc123");
  });
});

describe("renderManifest plugin metadata", () => {
  it("includes catalog metadata and source details", async () => {
    const now = new Date().toISOString();
    await writeFile(
      PLUGINS_STORE_PATH,
      JSON.stringify(
        {
          plugins: [
            {
              id: "worldguard",
              version: "1.2.3",
              provider: "custom",
              sha256: "stored-sha",
              minecraftVersionMin: "1.21.0",
              minecraftVersionMax: "1.21.1",
              cachePath: "data/cache/plugins/worldguard/1.2.3/worldguard.jar",
              artifactFileName: "worldguard.jar",
              cachedAt: now,
              lastUsedAt: now,
              createdAt: now,
              updatedAt: now,
              source: {
                provider: "custom",
                slug: "worldguard",
                downloadUrl: "https://example.com/worldguard.jar",
              },
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const project: StoredProject = {
      ...baseProject,
      plugins: [
        {
          id: "worldguard",
          version: "1.2.3",
          provider: "custom",
          sha256: "project-sha",
          cachePath: "data/cache/plugins/worldguard/1.2.3/worldguard.jar",
          minecraftVersionMin: "1.21.0",
          minecraftVersionMax: "1.21.1",
          source: {
            provider: "custom",
            slug: "worldguard",
            downloadUrl: "https://example.com/worldguard.jar",
            cachePath: "data/cache/plugins/worldguard/1.2.3/worldguard.jar",
          },
        },
      ],
    };

    const manifest = await renderManifest(project, "build-010");
    const json = JSON.parse(manifest) as {
      plugins: Array<{
        id: string;
        provider?: string;
        cachePath?: string;
        source?: { downloadUrl?: string };
        catalog?: { artifactFileName?: string };
      }>;
    };

    expect(json.plugins).toHaveLength(1);
    const entry = json.plugins[0];
    expect(entry.provider).toBe("custom");
    expect(entry.cachePath).toContain("worldguard/1.2.3");
    expect(entry.source?.downloadUrl).toBe("https://example.com/worldguard.jar");
    expect(entry.catalog?.artifactFileName).toBe("worldguard.jar");
  });
});


