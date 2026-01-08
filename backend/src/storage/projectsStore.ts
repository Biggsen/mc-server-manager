import { mkdir, readFile, writeFile, access } from "fs/promises";
import { join } from "path";
import { constants } from "fs";
import type { ProjectSummary } from "../types/projects";
import type {
  ManifestMetadata,
  ProjectsSnapshot,
  RepoMetadata,
  StoredProject,
} from "../types/storage";
import type { ProjectPlugin } from "../types/plugins";
import { getDataRoot, getDevDataPaths } from "../config";

const DATA_DIR = getDataRoot();
const MANIFEST_DIR = join(DATA_DIR, "data", "manifests");
const PROJECTS_PATH = join(DATA_DIR, "data", "projects.json");

async function ensureStore(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(MANIFEST_DIR, { recursive: true });

  try {
    await readFile(PROJECTS_PATH, "utf-8");
    // File exists, no migration needed
  } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // File doesn't exist - check if we should migrate from development directory
        if (process.env.ELECTRON_MODE === "true") {
          // In Electron mode, try to migrate from development backend/data directory
          // Try multiple possible locations for the development data
          const devDataPaths = getDevDataPaths();
          
          for (const devDataPath of devDataPaths) {
            const devProjectsPath = join(devDataPath, "projects.json");
            try {
              await access(devProjectsPath, constants.F_OK);
              // Development file exists, copy it
              const devData = await readFile(devProjectsPath, "utf-8");
              const devSnapshot = JSON.parse(devData) as ProjectsSnapshot;
              if (devSnapshot.projects && devSnapshot.projects.length > 0) {
                await writeFile(PROJECTS_PATH, devData, "utf-8");
                console.log(`[Migration] Copied ${devSnapshot.projects.length} projects from ${devProjectsPath}`);
                return;
              }
            } catch (migrationError) {
              // This path doesn't exist, try next one
              continue;
            }
          }
        }
      
      // Create empty file
      const empty: ProjectsSnapshot = { projects: [] };
      await writeFile(PROJECTS_PATH, JSON.stringify(empty, null, 2), "utf-8");
      return;
    }

    throw error;
  }
}

async function loadSnapshot(): Promise<ProjectsSnapshot> {
  await ensureStore();
  const contents = await readFile(PROJECTS_PATH, "utf-8");
  const snapshot = JSON.parse(contents) as ProjectsSnapshot;
  
  // If file is empty and we're in Electron mode, try to migrate from dev directory
  if (process.env.ELECTRON_MODE === "true" && snapshot.projects.length === 0 && contents.length < 50) {
    const devDataPaths = getDevDataPaths();
    
    for (const devDataPath of devDataPaths) {
      const devProjectsPath = join(devDataPath, "projects.json");
      try {
        await access(devProjectsPath, constants.F_OK);
        const devData = await readFile(devProjectsPath, "utf-8");
        const devSnapshot = JSON.parse(devData) as ProjectsSnapshot;
        if (devSnapshot.projects && devSnapshot.projects.length > 0) {
          await writeFile(PROJECTS_PATH, devData, "utf-8");
          console.log(`[Migration] Copied ${devSnapshot.projects.length} projects from ${devProjectsPath} (file was empty)`);
          return devSnapshot;
        }
      } catch (migrationError) {
        continue;
      }
    }
  }
  
  return snapshot;
}

async function persistSnapshot(snapshot: ProjectsSnapshot): Promise<void> {
  await ensureStore();
  await writeFile(PROJECTS_PATH, JSON.stringify(snapshot, null, 2), "utf-8");
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

  snapshot.projects[index] = updated;
  snapshot.projects.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  await persistSnapshot(snapshot);
  return updated;
}

export function getManifestFilePath(projectId: string, buildId: string): string {
  return join(MANIFEST_DIR, `${projectId}-${buildId}.json`);
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
      const configMap = new Map<
        string,
        NonNullable<StoredProject["configs"]>[number]
      >();
      for (const existing of project.configs ?? []) {
        configMap.set(existing.path, { ...existing });
      }
      for (const config of payload.configs) {
        const previous = configMap.get(config.path);
        configMap.set(config.path, {
          path: config.path,
          sha256: config.sha256 ?? previous?.sha256 ?? "<pending>",
          pluginId: config.pluginId ?? previous?.pluginId,
          definitionId: config.definitionId ?? previous?.definitionId,
        });
      }
      project.configs = Array.from(configMap.values());
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

