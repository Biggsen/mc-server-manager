import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { ProjectSummary } from "../types/projects";
import type {
  ManifestMetadata,
  ProjectsSnapshot,
  RepoMetadata,
  StoredProject,
} from "../types/storage";
import type { ProjectPlugin, ProjectPluginConfigMapping, PluginConfigDefinition } from "../types/plugins";
import { getDataRoot } from "../config";
import { findStoredPlugin } from "./pluginsStore";

// Helper functions to compute paths at runtime (not at module load)
function getDataDir(): string {
  return getDataRoot();
}

function getManifestDir(): string {
  return join(getDataDir(), "data", "manifests");
}

function getProjectsPath(): string {
  return join(getDataDir(), "data", "projects.json");
}

async function ensureStore(): Promise<void> {
  const dataDir = getDataDir();
  const manifestDir = getManifestDir();
  const projectsPath = getProjectsPath();

  await mkdir(dataDir, { recursive: true });
  await mkdir(manifestDir, { recursive: true });

  try {
    await readFile(projectsPath, "utf-8");
    // File exists, no action needed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // File doesn't exist - create empty file
      const empty: ProjectsSnapshot = { projects: [] };
      await writeFile(projectsPath, JSON.stringify(empty, null, 2), "utf-8");
      return;
    }
    throw error;
  }
}

async function loadSnapshot(): Promise<ProjectsSnapshot> {
  await ensureStore();
  const projectsPath = getProjectsPath();
  const contents = await readFile(projectsPath, "utf-8");
  const snapshot = JSON.parse(contents) as ProjectsSnapshot;
  return snapshot;
}

async function persistSnapshot(snapshot: ProjectsSnapshot): Promise<void> {
  await ensureStore();
  const projectsPath = getProjectsPath();
  await writeFile(projectsPath, JSON.stringify(snapshot, null, 2), "utf-8");
}

function toSummary(project: StoredProject): ProjectSummary {
  const {
    id,
    name,
    description,
    minecraftVersion,
    loader,
    updatedAt,
    source,
    manifest,
    plugins,
    configs,
    repo,
    snapshotSourceProjectId,
  } = project;
  return {
    id,
    name,
    description,
    minecraftVersion,
    loader,
    updatedAt,
    source,
    manifest,
    plugins,
    configs,
    repo,
    snapshotSourceProjectId,
  };
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const snapshot = await loadSnapshot();
  return snapshot.projects.map(toSummary);
}

export async function findProject(id: string): Promise<StoredProject | undefined> {
  const snapshot = await loadSnapshot();
  return snapshot.projects.find((project) => project.id === id);
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface CreateProjectInput {
  name: string;
  description?: string;
  minecraftVersion: string;
  loader: string;
  profilePath?: string;
  repo?: RepoMetadata;
}

export async function createProject(input: CreateProjectInput): Promise<StoredProject> {
  const snapshot = await loadSnapshot();
  const now = new Date().toISOString();
  const id = slugify(input.name);

  const project: StoredProject = {
    id,
    name: input.name,
    description: input.description,
    minecraftVersion: input.minecraftVersion,
    loader: input.loader,
    source: "created",
    repo: input.repo,
    repoUrl: input.repo?.htmlUrl,
    defaultBranch: input.repo?.defaultBranch,
    profilePath: input.profilePath ?? "profiles/base.yml",
    plugins: [],
    configs: [],
    createdAt: now,
    updatedAt: now,
  };

  snapshot.projects = snapshot.projects.filter((existing) => existing.id !== id);
  snapshot.projects.push(project);
  snapshot.projects.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  await persistSnapshot(snapshot);
  return project;
}

interface ImportProjectInput {
  name?: string;
  repoUrl: string;
  defaultBranch: string;
  profilePath: string;
  repo?: RepoMetadata;
}

export async function importProject(input: ImportProjectInput): Promise<StoredProject> {
  const snapshot = await loadSnapshot();
  const now = new Date().toISOString();
  const derivedName =
    input.name || input.repoUrl.split("/").filter(Boolean).slice(-1)[0] || "Imported Project";
  const id = slugify(derivedName);
  const repoMetadata = input.repo ?? createRepoMetadataFromUrl(input.repoUrl, input.defaultBranch);
  const normalizedRepoUrl = repoMetadata?.htmlUrl ?? input.repoUrl;

  const project: StoredProject = {
    id,
    name: derivedName,
    description: `Imported from ${input.repoUrl}`,
    minecraftVersion: "unknown",
    loader: "paper",
    source: "imported",
    repoUrl: normalizedRepoUrl,
    defaultBranch: input.defaultBranch,
    profilePath: input.profilePath,
    repo: repoMetadata,
    plugins: [],
    configs: [],
    createdAt: now,
    updatedAt: now,
  };

  snapshot.projects = snapshot.projects.filter((existing) => existing.id !== id);
  snapshot.projects.push(project);
  snapshot.projects.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  await persistSnapshot(snapshot);
  return project;
}

export async function updateProject(
  id: string,
  updater: (project: StoredProject) => StoredProject | void,
): Promise<StoredProject | undefined> {
  const snapshot = await loadSnapshot();
  const index = snapshot.projects.findIndex((project) => project.id === id);
  if (index === -1) {
    return undefined;
  }

  const original = snapshot.projects[index];
  const draft: StoredProject = JSON.parse(JSON.stringify(original));
  const result = updater(draft);
  const updated = (result as StoredProject) ?? draft;
  updated.updatedAt = new Date().toISOString();

  // Normalize configMappings for all plugins before saving
  if (updated.plugins) {
    for (const plugin of updated.plugins) {
      if (plugin.configMappings && plugin.configMappings.length > 0 && plugin.version) {
        // Load current library definitions
        const stored = await findStoredPlugin(plugin.id, plugin.version);
        const libraryDefinitions = stored?.configDefinitions ?? [];
        
        // Normalize mappings
        plugin.configMappings = normalizeConfigMappings(plugin.configMappings, libraryDefinitions);
      }
    }
  }

  // Update project.configs definitionIds when custom configs are converted to library configs
  if (updated.plugins && updated.configs) {
    for (const plugin of updated.plugins) {
      if (!plugin.version) continue;
      
      const stored = await findStoredPlugin(plugin.id, plugin.version);
      if (!stored?.configDefinitions) continue;

      // Build map of path -> library definition
      const pathToDefinitionMap = new Map<string, PluginConfigDefinition>();
      for (const definition of stored.configDefinitions) {
        pathToDefinitionMap.set(definition.path, definition);
      }

      // Update configs that have custom definitionIds but paths matching library definitions
      for (const config of updated.configs) {
        if (config.pluginId === plugin.id && config.path) {
          const matchingDefinition = pathToDefinitionMap.get(config.path);
          if (matchingDefinition) {
            // Path matches a library definition - ensure definitionId is correct
            if (config.definitionId !== matchingDefinition.id) {
              // Update to use library definitionId
              config.definitionId = matchingDefinition.id;
            }
          }
        }
      }
    }
  }

  // Update project.configs paths if library definition paths changed
  if (updated.plugins && updated.configs) {
    const configsMap = new Map<string, typeof updated.configs[0]>();
    // Build initial map from current configs
    for (const config of updated.configs) {
      configsMap.set(config.path, { ...config });
    }

    for (const plugin of updated.plugins) {
      if (!plugin.version) continue;
      
      const stored = await findStoredPlugin(plugin.id, plugin.version);
      if (!stored?.configDefinitions) continue;

      // Build map of definitionId -> current path
      const definitionPathMap = new Map<string, string>();
      for (const definition of stored.configDefinitions) {
        definitionPathMap.set(definition.id, definition.path);
      }

      // Check all configs for this plugin and update paths if needed
      const configsToUpdate: Array<{ oldPath: string; newPath: string; config: typeof updated.configs[0] }> = [];
      for (const config of updated.configs) {
        if (config.pluginId === plugin.id && config.definitionId) {
          const currentPath = definitionPathMap.get(config.definitionId);
          if (currentPath && currentPath !== config.path) {
            // Library definition path changed - mark for update
            const existingConfig = configsMap.get(config.path);
            if (existingConfig) {
              configsToUpdate.push({
                oldPath: config.path,
                newPath: currentPath,
                config: existingConfig,
              });
            }
          }
        }
      }

      // Apply path updates
      for (const { oldPath, newPath, config: configToUpdate } of configsToUpdate) {
        configsMap.delete(oldPath);
        // Only add if new path doesn't already exist (avoid duplicates)
        if (!configsMap.has(newPath)) {
          configsMap.set(newPath, {
            ...configToUpdate,
            path: newPath,
          });
        }
      }
    }

    // Update configs array with normalized paths
    updated.configs = Array.from(configsMap.values());
  }

  snapshot.projects[index] = updated;
  snapshot.projects.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  await persistSnapshot(snapshot);
  return updated;
}

export function getManifestFilePath(projectId: string, buildId: string): string {
  return join(getManifestDir(), `${projectId}-${buildId}.json`);
}

export async function recordManifestMetadata(projectId: string, metadata: ManifestMetadata): Promise<StoredProject | undefined> {
  return updateProject(projectId, (project) => {
    project.manifest = metadata;
    return project;
  });
}

interface AssetsPayload {
  plugins?: StoredProject["plugins"];
  configs?: StoredProject["configs"];
}

export async function setProjectAssets(id: string, payload: AssetsPayload): Promise<StoredProject | undefined> {
  return updateProject(id, (project) => {
    if (payload.plugins) {
      const existingMap = new Map<string, ProjectPlugin>();
      for (const existing of project.plugins ?? []) {
        existingMap.set(existing.id, existing);
      }

      for (const plugin of payload.plugins) {
        const previous = existingMap.get(plugin.id);
        const mergedSource =
          plugin.source && previous?.source
            ? { ...previous.source, ...plugin.source }
            : plugin.source ?? previous?.source;
        const cachePath = plugin.cachePath ?? previous?.cachePath;
        if (cachePath && mergedSource) {
          mergedSource.cachePath = cachePath;
        }
        const mergedMappings =
          plugin.configMappings ?? previous?.configMappings ?? [];
        const merged: ProjectPlugin = {
          ...previous,
          id: plugin.id,
          version: plugin.version,
          sha256: plugin.sha256 ?? previous?.sha256 ?? "<pending>",
          provider: plugin.provider ?? previous?.provider,
          source: mergedSource,
          cachePath,
          minecraftVersionMin: plugin.minecraftVersionMin ?? previous?.minecraftVersionMin,
          minecraftVersionMax: plugin.minecraftVersionMax ?? previous?.minecraftVersionMax,
          configMappings: mergedMappings,
        };
        existingMap.set(plugin.id, merged);
      }

      project.plugins = Array.from(existingMap.values());
    }
    if (payload.configs) {
      // Important: `payload.configs` is the full desired set of config assets.
      // We must REPLACE (not merge) so deletions are respected.
      const previousMap = new Map<string, NonNullable<StoredProject["configs"]>[number]>();
      for (const existing of project.configs ?? []) {
        previousMap.set(existing.path, { ...existing });
      }

      const next = payload.configs.map((config) => {
        const previous = previousMap.get(config.path);
        return {
          path: config.path,
          sha256: config.sha256 ?? previous?.sha256 ?? "<pending>",
          pluginId: config.pluginId ?? previous?.pluginId,
          definitionId: config.definitionId ?? previous?.definitionId,
        };
      });

      project.configs = next;
    }
    return project;
  });
}

export async function upsertProjectPlugin(
  id: string,
  plugin: ProjectPlugin,
): Promise<StoredProject | undefined> {
  return updateProject(id, (project) => {
    const plugins = [...(project.plugins ?? [])];
    const index = plugins.findIndex((entry) => entry.id === plugin.id);
    if (index >= 0) {
      plugins[index] = {
        ...plugins[index],
        ...plugin,
      };
    } else {
      plugins.push(plugin);
    }
    project.plugins = plugins;
    return project;
  });
}

export async function removeProjectPlugin(
  id: string,
  pluginId: string,
): Promise<StoredProject | undefined> {
  return updateProject(id, (project) => {
    project.plugins = (project.plugins ?? []).filter((plugin) => plugin.id !== pluginId);
    return project;
  });
}

export async function deleteProjectRecord(id: string): Promise<StoredProject | undefined> {
  const snapshot = await loadSnapshot();
  const index = snapshot.projects.findIndex((project) => project.id === id);
  if (index === -1) {
    return undefined;
  }

  const [removed] = snapshot.projects.splice(index, 1);
  await persistSnapshot(snapshot);
  return removed;
}

function isNewFormatMapping(mapping: ProjectPluginConfigMapping): mapping is Extract<ProjectPluginConfigMapping, { type: 'library' }> | Extract<ProjectPluginConfigMapping, { type: 'custom' }> {
  return 'type' in mapping && (mapping.type === 'library' || mapping.type === 'custom');
}

function normalizeConfigMappings(
  mappings: ProjectPluginConfigMapping[],
  libraryDefinitions: PluginConfigDefinition[]
): ProjectPluginConfigMapping[] {
  const definitionMap = new Map<string, PluginConfigDefinition>();
  const pathToDefinitionMap = new Map<string, PluginConfigDefinition>();
  for (const definition of libraryDefinitions) {
    definitionMap.set(definition.id, definition);
    pathToDefinitionMap.set(definition.path, definition);
  }

  const normalized = mappings.map((mapping) => {
    // Already in new format
    if (isNewFormatMapping(mapping)) {
      if (mapping.type === 'library') {
        // Ensure library definition still exists
        if (!definitionMap.has(mapping.definitionId)) {
          return null; // Remove invalid library mapping
        }
        return mapping;
      } else {
        // Custom mapping - check if path matches a library definition
        const matchingDefinition = pathToDefinitionMap.get(mapping.path);
        if (matchingDefinition) {
          // Convert custom config to library config (path matches library definition)
          return {
            type: 'library',
            definitionId: matchingDefinition.id,
            notes: mapping.notes,
          };
        }
        // Keep as custom
        return mapping;
      }
    }

    // Old format - migrate
    const oldMapping = mapping as any;
    const definitionId = oldMapping.definitionId;
    
    if (definitionMap.has(definitionId)) {
      // Library config
      return {
        type: 'library',
        definitionId,
        notes: oldMapping.notes,
      };
    } else {
      // Custom config - check if path matches a library definition
      const path = oldMapping.path;
      if (path) {
        const matchingDefinition = pathToDefinitionMap.get(path);
        if (matchingDefinition) {
          // Convert to library config
          return {
            type: 'library',
            definitionId: matchingDefinition.id,
            notes: oldMapping.notes,
          };
        }
      }
      
      if (!path) {
        return null; // Invalid custom config without path
      }
      
      const customId = definitionId.startsWith('custom/')
        ? definitionId
        : `custom/${definitionId}`;
      
      return {
        type: 'custom',
        customId,
        label: oldMapping.label || customId,
        path,
        notes: oldMapping.notes,
      };
    }
  }).filter((m): m is ProjectPluginConfigMapping => m !== null);

  // Deduplicate library configs - if multiple library configs have the same definitionId, keep the first one
  const seenLibraryIds = new Set<string>();
  const deduplicated: ProjectPluginConfigMapping[] = [];
  
  for (const mapping of normalized) {
    if (isNewFormatMapping(mapping) && mapping.type === 'library') {
      if (seenLibraryIds.has(mapping.definitionId)) {
        // Skip duplicate library config
        continue;
      }
      seenLibraryIds.add(mapping.definitionId);
    }
    deduplicated.push(mapping);
  }

  return deduplicated;
}

function createRepoMetadataFromUrl(repoUrl: string, defaultBranch: string): RepoMetadata | undefined {
  const trimmed = repoUrl.trim();
  const match =
    trimmed.match(
      /github\.com[:/](?<owner>[^/]+)\/(?<name>[^/]+?)(?:\.git)?(?:[#?].*)?$/i,
    ) ?? undefined;

  if (!match?.groups) {
    return undefined;
  }

  const owner = match.groups.owner;
  const name = match.groups.name.replace(/\.git$/i, "");
  const htmlUrl = `https://github.com/${owner}/${name}`;

  return {
    owner,
    name,
    fullName: `${owner}/${name}`,
    htmlUrl,
    defaultBranch,
  };
}

