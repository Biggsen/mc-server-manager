import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { ProjectSummary } from "../types/projects";
import type {
  ManifestMetadata,
  ProjectsSnapshot,
  RepoMetadata,
  StoredProject,
} from "../types/storage";
import type { ProjectPlugin } from "../types/plugins";
import { getDataRoot } from "../config";

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

