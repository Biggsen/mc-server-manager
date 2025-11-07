import { readFile } from "fs/promises";
import { join } from "path";
import Handlebars from "handlebars";
import type { StoredProject } from "../types/storage";

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

export async function renderManifest(project: StoredProject, buildId: string): Promise<string> {
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
    plugins: [],
    configs: [],
    artifact: {
      zipPath: `dist/${project.id}-${buildId}.zip`,
      sha256: "<pending>",
      size: 0,
    },
  };

  return template(context);
}

