import { readFile } from "fs/promises";
import { join } from "path";
import Handlebars from "handlebars";
import type { StoredProject } from "../types/storage";

export interface ManifestOverrides {
  minecraft?: Partial<ManifestContext["minecraft"]>;
  world?: Partial<ManifestContext["world"]>;
  plugins?: ManifestContext["plugins"];
  configs?: ManifestContext["configs"];
  artifact?: Partial<ManifestContext["artifact"]>;
}

interface ManifestContext {
  projectId: string;
  buildId: string;
  minecraft: {
    loader: string;
    version: string;
  };
  world: {
    mode: string;
    seed: string;
    name: string;
  };
  plugins: Array<{ id: string; version: string; sha256: string }>;
  configs: Array<{ path: string; sha256: string }>;
  artifact: {
    zipPath: string;
    sha256: string;
    size: number;
  };
}

export async function renderManifest(
  project: StoredProject,
  buildId: string,
  overrides: ManifestOverrides = {},
): Promise<string> {
  const templatePath = join(process.cwd(), "..", "templates", "server", "manifest.template.json");
  const templateSource = await readFile(templatePath, "utf-8");
  const template = Handlebars.compile<ManifestContext>(templateSource);

  const context: ManifestContext = {
    projectId: project.id,
    buildId,
    minecraft: {
      loader: project.loader,
      version: project.minecraftVersion,
    },
    world: {
      mode: "generated",
      seed: "",
      name: "world",
    },
    plugins: project.plugins?.map((plugin) => ({
      id: plugin.id,
      version: plugin.version,
      sha256: plugin.sha256 ?? "<pending>",
    })) ?? [],
    configs: project.configs?.map((config) => ({
      path: config.path,
      sha256: config.sha256 ?? "<pending>",
    })) ?? [],
    artifact: {
      zipPath: `dist/${project.id}-${buildId}.zip`,
      sha256: "<pending>",
      size: 0,
    },
  };

  if (overrides.minecraft) {
    context.minecraft = { ...context.minecraft, ...overrides.minecraft };
  }
  if (overrides.world) {
    context.world = { ...context.world, ...overrides.world };
  }
  if (overrides.plugins) {
    context.plugins = overrides.plugins;
  }
  if (overrides.configs) {
    context.configs = overrides.configs;
  }
  if (overrides.artifact) {
    context.artifact = { ...context.artifact, ...overrides.artifact };
  }

  return template(context);
}

