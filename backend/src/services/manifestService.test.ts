import { describe, expect, it } from "vitest";
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


