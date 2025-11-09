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

const DATA_DIR = join(process.cwd(), "data");
const MANIFEST_DIR = join(DATA_DIR, "manifests");
const PROJECTS_PATH = join(DATA_DIR, "projects.json");

async function ensureStore(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(MANIFEST_DIR, { recursive: true });

  try {
    await readFile(PROJECTS_PATH, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
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
  return JSON.parse(contents) as ProjectsSnapshot;
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
      project.plugins = payload.plugins.map((plugin) => {
        const previous = existingMap.get(plugin.id);
        const mergedSource =
          plugin.source && previous?.source
            ? { ...previous.source, ...plugin.source }
            : plugin.source ?? previous?.source;
        const cachePath = plugin.cachePath ?? previous?.cachePath;
        if (cachePath && mergedSource) {
          mergedSource.cachePath = cachePath;
        }
        return {
          ...previous,
          id: plugin.id,
          version: plugin.version,
          sha256: plugin.sha256 ?? previous?.sha256 ?? "<pending>",
          provider: plugin.provider ?? previous?.provider,
          source: mergedSource,
          cachePath,
          minecraftVersionMin: plugin.minecraftVersionMin ?? previous?.minecraftVersionMin,
          minecraftVersionMax: plugin.minecraftVersionMax ?? previous?.minecraftVersionMax,
        };
      });
    }
    if (payload.configs) {
      project.configs = payload.configs.map((config) => ({
        path: config.path,
        sha256: config.sha256 ?? "<pending>",
      }));
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

