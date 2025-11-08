import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { createHash } from "crypto";

const originalCwd = process.cwd;

describe("projectScanner", () => {
  let tempRoot: string;
  let workspace: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "mc-scanner-"));
    workspace = join(tempRoot, "workspace");
    await mkdir(workspace, { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(workspace);

    // Ensure template directory exists for fallback reads.
    await mkdir(join(tempRoot, "templates", "server"), { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("parses base profile and overlays, generating hashes for assets", async () => {
    const projectId = "test-project";
    const projectRoot = join(workspace, "data", "projects", projectId);
    await mkdir(join(projectRoot, "profiles"), { recursive: true });
    await mkdir(join(projectRoot, "overlays"), { recursive: true });
    await mkdir(join(projectRoot, "plugins"), { recursive: true });
    await mkdir(join(projectRoot, "configs"), { recursive: true });
    await mkdir(join(projectRoot, "config"), { recursive: true });

    await writeFile(
      join(projectRoot, "profiles", "base.yml"),
      `
plugins:
  - id: worldguard
    version: "7.0.10"
configs:
  files:
    - template: server.properties.hbs
      output: server.properties
`,
    );

    await writeFile(
      join(projectRoot, "overlays", "dev.yml"),
      `
plugins:
  - id: placeholderapi
    version: "2.11.6"
configs:
  files:
    - template: paper-global.yml.hbs
      output: config/paper-global.yml
`,
    );

    const worldguardJar = join(projectRoot, "plugins", "worldguard-7.0.10.jar");
    await writeFile(worldguardJar, "worldguard jar content");

    const placeholderJar = join(projectRoot, "plugins", "placeholderapi-2.11.6.jar");
    await writeFile(placeholderJar, "placeholder api jar content");

    const serverProperties = join(projectRoot, "server.properties");
    await writeFile(serverProperties, "motd=hello");

    const paperConfig = join(projectRoot, "config", "paper-global.yml");
    await writeFile(paperConfig, "chunk-system:\n  target-tick-distance: 6\n");

    vi.resetModules();
    const { scanProjectAssets } = await import("./projectScanner");

    const assets = await scanProjectAssets({
      id: projectId,
      name: "Test Project",
      loader: "paper",
      minecraftVersion: "1.21.1",
      source: "created",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      plugins: [],
      configs: [],
    });

    const hash = (value: string) => createHash("sha256").update(value).digest("hex");

    expect(assets.plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "worldguard",
          version: "7.0.10",
          sha256: hash("worldguard jar content"),
        }),
        expect.objectContaining({
          id: "placeholderapi",
          version: "2.11.6",
          sha256: hash("placeholder api jar content"),
        }),
      ]),
    );

    expect(assets.configs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "server.properties",
          sha256: hash("motd=hello"),
        }),
        expect.objectContaining({
          path: "config/paper-global.yml",
          sha256: hash("chunk-system:\n  target-tick-distance: 6\n"),
        }),
      ]),
    );
  });
});

