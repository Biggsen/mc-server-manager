import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "path";
import { mkdtemp, rm, readFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import type { StoredProject } from "../types/storage";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("buildQueue persistence", () => {
  let tempRoot: string;
  let workspace: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "mc-buildqueue-"));
    workspace = join(tempRoot, "workspace");
    await mkdir(workspace, { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(workspace);
    await mkdir(join(workspace, "data", "manifests"), { recursive: true });

    vi.doMock("./manifestService", () => ({
      renderManifest: vi.fn(async () => '{"ok":true}'),
    }));
  });

  afterEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("persists jobs to disk and loads them on startup", async () => {
    const { enqueueBuild, listBuilds } = await import("./buildQueue");

    const project: StoredProject = {
      id: "proj-1",
      name: "Test",
      description: "",
      minecraftVersion: "1.21.1",
      loader: "paper",
      source: "created",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      plugins: [],
      configs: [],
    };

    const build = await enqueueBuild(project);
    expect(["pending", "running"]).toContain(build.status);

    await delay(100);

    const builds = listBuilds();
    expect(builds).toHaveLength(1);
    expect(builds[0].status).toBe("succeeded");

    const log = JSON.parse(
      await readFile(join(workspace, "data", "builds", "builds.json"), "utf-8"),
    );
    expect(log.builds).toHaveLength(1);

    vi.resetModules();
    vi.spyOn(process, "cwd").mockReturnValue(workspace);
    vi.doMock("./manifestService", () => ({
      renderManifest: vi.fn(async () => '{"ok":true}'),
    }));
    const reloaded = await import("./buildQueue");
    await delay(50);
    const buildsAfterReload = reloaded.listBuilds();
    expect(buildsAfterReload).toHaveLength(1);
    expect(buildsAfterReload[0].status).toBe("succeeded");
  });
});

