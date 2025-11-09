import { readFile } from "fs/promises";
import { join } from "path";
import Handlebars from "handlebars";
import type { StoredProject } from "../types/storage";
import { findStoredPlugin } from "../storage/pluginsStore";
import type { PluginSourceReference } from "../types/plugins";

Handlebars.registerHelper("json", (value: unknown) => JSON.stringify(value, null, 2));

export interface ManifestOverrides {
  minecraft?: Partial<ManifestContext["minecraft"]>;
  world?: Partial<ManifestContext["world"]>;
  plugins?: ManifestPluginEntry[];
  configs?: ManifestContext["configs"];
  artifact?: Partial<ManifestContext["artifact"]>;
  repository?: Partial<ManifestContext["repository"]>;
}

interface ManifestPluginEntry {
  id: string;
  version: string;
  sha256: string;
  provider?: string;
  cachePath?: string;
  minecraftVersionMin?: string;
  minecraftVersionMax?: string;
  source?: PluginSourceReference;
  catalog?: {
    cachedAt?: string;
    lastUsedAt?: string;
    artifactFileName?: string;
  };
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
  plugins: ManifestPluginEntry[];
  configs: Array<{ path: string; sha256: string }>;
  artifact: {
    zipPath: string;
    sha256: string;
    size: number;
  };
  repository: {
    url: string;
    fullName?: string;
    defaultBranch?: string;
    commit?: string;
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

  const defaultPlugins = await buildManifestPlugins(project);
  const plugins = mergePluginOverrides(defaultPlugins, overrides.plugins);

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
    plugins,
    configs: project.configs?.map((config) => ({
      path: config.path,
      sha256: config.sha256 ?? "<pending>",
    })) ?? [],
    artifact: {
      zipPath: `dist/${project.id}-${buildId}.zip`,
      sha256: "<pending>",
      size: 0,
    },
    repository: {
      url: project.repo?.htmlUrl ?? project.repoUrl ?? "",
      fullName: project.repo?.fullName,
      defaultBranch: project.repo?.defaultBranch ?? project.defaultBranch ?? "main",
      commit: project.manifest?.commitSha,
    },
  };

  if (overrides.minecraft) {
    context.minecraft = { ...context.minecraft, ...overrides.minecraft };
  }
  if (overrides.world) {
    context.world = { ...context.world, ...overrides.world };
  }
  if (overrides.configs) {
    context.configs = overrides.configs;
  }
  if (overrides.artifact) {
    context.artifact = { ...context.artifact, ...overrides.artifact };
  }
  if (overrides.repository) {
    context.repository = { ...context.repository, ...overrides.repository };
  }

  return template(context);
}

async function buildManifestPlugins(project: StoredProject): Promise<ManifestPluginEntry[]> {
  const plugins = project.plugins ?? [];
  return Promise.all(
    plugins.map(async (plugin) => {
      const version = plugin.version ?? "latest";
      const stored = await findStoredPlugin(plugin.id, version);
      const cachePath =
        plugin.cachePath ??
        plugin.source?.cachePath ??
        stored?.cachePath ??
        stored?.source?.cachePath;
      const source = mergeSourceMetadata(
        plugin.id,
        stored?.source,
        plugin.source,
        cachePath,
      );

      return {
        id: plugin.id,
        version,
        sha256: plugin.sha256 ?? stored?.sha256 ?? "<pending>",
        provider: plugin.provider ?? stored?.provider ?? source?.provider,
        cachePath,
        minecraftVersionMin:
          plugin.minecraftVersionMin ??
          stored?.minecraftVersionMin ??
          source?.minecraftVersionMin,
        minecraftVersionMax:
          plugin.minecraftVersionMax ??
          stored?.minecraftVersionMax ??
          source?.minecraftVersionMax,
        source,
        catalog: stored
          ? {
              cachedAt: stored.cachedAt,
              lastUsedAt: stored.lastUsedAt,
              artifactFileName: stored.artifactFileName,
            }
          : undefined,
      };
    }),
  );
}

function mergePluginOverrides(
  base: ManifestPluginEntry[],
  overrides?: ManifestPluginEntry[],
): ManifestPluginEntry[] {
  if (!overrides || overrides.length === 0) {
    return base;
  }

  const baseMap = new Map(base.map((entry) => [pluginKey(entry), entry]));
  const seen = new Set<string>();
  const merged: ManifestPluginEntry[] = [];

  for (const override of overrides) {
    const key = pluginKey(override);
    const existing = baseMap.get(key);
    const version = override.version ?? existing?.version ?? "latest";
    const cachePath = override.cachePath ?? existing?.cachePath;
    const source = mergeSourceMetadata(
      override.id,
      existing?.source,
      override.source,
      cachePath,
    );

    merged.push({
      id: override.id,
      version,
      sha256: override.sha256 ?? existing?.sha256 ?? "<pending>",
      provider: override.provider ?? existing?.provider ?? source?.provider,
      cachePath,
      minecraftVersionMin:
        override.minecraftVersionMin ?? existing?.minecraftVersionMin,
      minecraftVersionMax:
        override.minecraftVersionMax ?? existing?.minecraftVersionMax,
      source,
      catalog: existing?.catalog,
    });
    seen.add(key);
  }

  for (const entry of base) {
    const key = pluginKey(entry);
    if (!seen.has(key)) {
      merged.push(entry);
    }
  }

  return merged;
}

function pluginKey(entry: { id: string; version?: string }): string {
  return `${entry.id}:${entry.version ?? "latest"}`;
}

function mergeSourceMetadata(
  pluginId: string,
  stored?: PluginSourceReference,
  current?: PluginSourceReference,
  cachePath?: string,
): PluginSourceReference | undefined {
  const base = current ?? stored;
  if (!base) {
    if (!cachePath) {
      return undefined;
    }
    return {
      provider: "custom",
      slug: pluginId,
      cachePath,
    };
  }

  const merged: PluginSourceReference = {
    ...stored,
    ...current,
    provider: (current?.provider ?? stored?.provider ?? base.provider) as PluginSourceReference["provider"],
    slug: (current?.slug ?? stored?.slug ?? base.slug) ?? pluginId,
  };

  if (cachePath) {
    merged.cachePath = cachePath;
  }

  return merged;
}

