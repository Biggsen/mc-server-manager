import type { Request, Response } from "express";
import { Router } from "express";
import { writeFile, stat } from "fs/promises";
import { join } from "path";
import multer from "multer";
import { createHash } from "crypto";
import {
  createProject,
  findProject,
  importProject,
  listProjects,
  getManifestFilePath,
  recordManifestMetadata,
  setProjectAssets,
  updateProject,
  upsertProjectPlugin,
  deleteProjectRecord,
  removeProjectPlugin,
} from "../storage/projectsStore";
import type { ProjectSummary } from "../types/projects";
import type { ManifestMetadata, RepoMetadata, StoredProject } from "../types/storage";
import type {
  PluginProvider,
  PluginSourceReference,
  PluginConfigDefinition,
  PluginConfigRequirement,
  ProjectPlugin,
  ProjectPluginConfigMapping,
} from "../types/plugins";
import { renderManifest, type ManifestOverrides } from "../services/manifestService";
import { enqueueBuild } from "../services/buildQueue";
import { scanProjectAssets } from "../services/projectScanner";
import { getProjectsRoot, getDevDataPaths } from "../config";
import { commitFiles, getOctokitForRequest } from "../services/githubClient";
import {
  collectProjectDefinitionFiles,
  readProjectFile,
  renderConfigFiles,
  writeProjectFile,
  writeProjectFileBuffer,
} from "../services/projectFiles";
import { enqueueRun, listRuns, resetProjectWorkspace } from "../services/runQueue";
import { findStoredPlugin, upsertStoredPlugin } from "../storage/pluginsStore";
import { deleteProjectResources } from "../services/projectDeletion";
import {
  listUploadedConfigFiles,
  overwriteUploadedConfigFile,
  readUploadedConfigFile,
  saveUploadedConfigFile,
  deleteUploadedConfigFile,
  collectUploadedConfigMaterials,
  type ConfigFileSummary,
} from "../services/configUploads";
import { optionalAuth } from "../middleware/auth";

const router = Router();
router.use(optionalAuth);
const pluginUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 64 * 1024 * 1024,
  },
});

const configUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 16 * 1024 * 1024,
  },
});

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function sanitizeConfigPathStrict(path: string): string {
  let normalized = path.replace(/\\/g, "/").trim();
  if (normalized.startsWith("/")) {
    normalized = normalized.slice(1);
  }
  if (!normalized) {
    throw new Error("Config path cannot be empty");
  }
  if (normalized.includes("..")) {
    throw new Error("Config path cannot contain traversal segments");
  }
  return normalized;
}

function sanitizeOptionalConfigPath(input: unknown): string | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }
  if (typeof input !== "string") {
    throw new Error("Config path override must be a string");
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }
  return sanitizeConfigPathStrict(trimmed);
}

const PLUGIN_CONFIG_REQUIREMENTS: PluginConfigRequirement[] = ["required", "optional", "generated"];

function normalizeRequirement(
  value: unknown,
  fallback: PluginConfigRequirement = "optional",
): PluginConfigRequirement {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase() as PluginConfigRequirement;
  if (!PLUGIN_CONFIG_REQUIREMENTS.includes(normalized)) {
    throw new Error(
      `Requirement must be one of ${PLUGIN_CONFIG_REQUIREMENTS.join(", ")}`,
    );
  }
  return normalized;
}

interface PluginConfigDefinitionView {
  id: string;
  source: "library" | "custom";
  label?: string;
  description?: string;
  tags?: string[];
  defaultPath: string;
  resolvedPath: string;
  requirement: PluginConfigRequirement;
  notes?: string;
  mapping?: ProjectPluginConfigMapping;
  uploaded?: ConfigFileSummary;
  missing: boolean;
}

function buildPluginConfigViews(
  pluginId: string,
  plugin: ProjectPlugin,
  libraryDefinitions: PluginConfigDefinition[],
  summaries: ConfigFileSummary[],
): { definitions: PluginConfigDefinitionView[]; unmatchedUploads: ConfigFileSummary[] } {
  const definitionMap = new Map<string, PluginConfigDefinition>();
  for (const definition of libraryDefinitions) {
    definitionMap.set(definition.id, definition);
  }
  const mappings = plugin.configMappings ?? [];
  const mappingById = new Map<string, ProjectPluginConfigMapping>();
  for (const mapping of mappings) {
    mappingById.set(mapping.definitionId, mapping);
  }

  const relevantDefinitionIds = new Set<string>([
    ...libraryDefinitions.map((definition) => definition.id),
    ...mappings.map((mapping) => mapping.definitionId),
  ]);

  const pluginSummaries = summaries.filter((summary) => {
    if (summary.pluginId === pluginId) {
      return true;
    }
    if (summary.definitionId && relevantDefinitionIds.has(summary.definitionId)) {
      return true;
    }
    return false;
  });

  const summaryByDefinition = new Map<string, ConfigFileSummary>();
  const summaryByPath = new Map<string, ConfigFileSummary[]>();
  for (const summary of pluginSummaries) {
    if (summary.definitionId) {
      summaryByDefinition.set(summary.definitionId, summary);
    }
    const bucket = summaryByPath.get(summary.path);
    if (bucket) {
      bucket.push(summary);
    } else {
      summaryByPath.set(summary.path, [summary]);
    }
  }

  const matchedSummaries = new Set<ConfigFileSummary>();

  const resolveUpload = (definitionId: string, resolvedPath: string): ConfigFileSummary | undefined => {
    const byId = summaryByDefinition.get(definitionId);
    if (byId) {
      return byId;
    }
    const bucket = summaryByPath.get(resolvedPath);
    if (bucket && bucket.length > 0) {
      const directMatch = bucket.find(
        (summary) => summary.pluginId === pluginId || summary.pluginId === undefined,
      );
      return directMatch ?? bucket[0];
    }
    return undefined;
  };

  const views: PluginConfigDefinitionView[] = [];

  for (const definition of libraryDefinitions) {
    const mapping = mappingById.get(definition.id);
    const resolvedPath = mapping?.path ?? definition.path;
    const resolvedRequirement = mapping
      ? normalizeRequirement(mapping.requirement, definition.requirement ?? "optional")
      : normalizeRequirement(definition.requirement, "optional");
    const uploaded = resolveUpload(definition.id, resolvedPath);
    if (uploaded) {
      matchedSummaries.add(uploaded);
    }
    views.push({
      id: definition.id,
      source: "library",
      label: definition.label,
      description: definition.description,
      tags: definition.tags,
      defaultPath: definition.path,
      resolvedPath,
      requirement: resolvedRequirement,
      notes: mapping?.notes,
      mapping,
      uploaded,
      missing: resolvedRequirement === "required" && !uploaded,
    });
  }

  for (const mapping of mappings) {
    if (definitionMap.has(mapping.definitionId)) {
      continue;
    }
    const resolvedPath = mapping.path ?? "";
    const resolvedRequirement = normalizeRequirement(mapping.requirement, "optional");
    const uploaded = resolveUpload(mapping.definitionId, resolvedPath);
    if (uploaded) {
      matchedSummaries.add(uploaded);
    }
    views.push({
      id: mapping.definitionId,
      source: "custom",
      label: mapping.label ?? mapping.definitionId,
      description: undefined,
      tags: undefined,
      defaultPath: resolvedPath,
      resolvedPath,
      requirement: resolvedRequirement,
      notes: mapping.notes,
      mapping,
      uploaded,
      missing: resolvedRequirement === "required" && !uploaded,
    });
  }

  views.sort((a, b) => a.resolvedPath.localeCompare(b.resolvedPath));

  const unmatchedUploads = pluginSummaries.filter((summary) => !matchedSummaries.has(summary));

  return { definitions: views, unmatchedUploads };
}

function findPluginMappingForPath(
  project: StoredProject,
  path: string,
): { pluginId: string; definitionId?: string } | undefined {
  for (const plugin of project.plugins ?? []) {
    for (const mapping of plugin.configMappings ?? []) {
      if (mapping.path === path) {
        return { pluginId: plugin.id, definitionId: mapping.definitionId };
      }
    }
  }
  return undefined;
}

async function reconcilePluginConfigMetadata(
  projectId: string,
  project: StoredProject,
  plugin: ProjectPlugin,
  libraryDefinitions: PluginConfigDefinition[],
): Promise<void> {
  const mappings = plugin.configMappings ?? [];
  const mappingById = new Map<string, ProjectPluginConfigMapping>();
  for (const mapping of mappings) {
    mappingById.set(mapping.definitionId, mapping);
  }

  const resolvedPathMap = new Map<string, { pluginId: string; definitionId: string }>();
  for (const definition of libraryDefinitions) {
    const mapping = mappingById.get(definition.id);
    const resolvedPath = mapping?.path ?? definition.path;
    if (resolvedPath) {
      resolvedPathMap.set(resolvedPath, { pluginId: plugin.id, definitionId: definition.id });
    }
  }
  for (const mapping of mappings) {
    if (!mapping.path) {
      continue;
    }
    resolvedPathMap.set(mapping.path, { pluginId: plugin.id, definitionId: mapping.definitionId });
  }

  const knownDefinitionIds = new Set<string>([
    ...libraryDefinitions.map((definition) => definition.id),
    ...mappings.map((mapping) => mapping.definitionId),
  ]);

  let changed = false;
  const nextConfigs = (project.configs ?? []).map((entry) => {
    const mappingInfo = resolvedPathMap.get(entry.path);
    if (mappingInfo) {
      if (entry.pluginId !== mappingInfo.pluginId || entry.definitionId !== mappingInfo.definitionId) {
        changed = true;
        return {
          ...entry,
          pluginId: mappingInfo.pluginId,
          definitionId: mappingInfo.definitionId,
        };
      }
      return entry;
    }
    if (entry.pluginId === plugin.id && entry.definitionId && !knownDefinitionIds.has(entry.definitionId)) {
      changed = true;
      const cloned: typeof entry = { ...entry };
      delete (cloned as { definitionId?: string }).definitionId;
      return cloned;
    }
    return entry;
  });

  if (!changed) {
    return;
  }

  nextConfigs.sort((a, b) => a.path.localeCompare(b.path));
  await setProjectAssets(projectId, { configs: nextConfigs });
}

interface RepoParseSuccess {
  success: true;
  repo: RepoMetadata;
}

interface RepoParseFailure {
  success: false;
  error: string;
}

function parseRepoPayload(input: unknown): RepoParseSuccess | RepoParseFailure {
  if (typeof input !== "object" || input === null) {
    return { success: false, error: "Invalid repo payload" };
  }

  const repo = input as Partial<RepoMetadata> & { owner?: string; name?: string };
  const { owner, name, fullName, htmlUrl, defaultBranch } = repo;
  if (!owner || !name || !fullName || !htmlUrl || !defaultBranch) {
    return { success: false, error: "Repo payload is missing one or more required fields" };
  }

  return {
    success: true,
    repo: {
      id: repo.id,
      owner,
      name,
      fullName,
      htmlUrl,
      defaultBranch,
    },
  };
}

function toSummary(project: StoredProject): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    minecraftVersion: project.minecraftVersion,
    loader: project.loader,
    updatedAt: project.updatedAt,
    source: project.source,
    manifest: project.manifest,
    plugins: project.plugins,
    configs: project.configs,
    repo: project.repo,
  };
}

async function ensureProjectAssetsCached(project: StoredProject): Promise<StoredProject> {
  if (project.plugins?.length && project.configs?.length) {
    return project;
  }

  const scanned = await scanProjectAssets(project);
  const updated = await setProjectAssets(project.id, scanned);
  return updated ?? project;
}

function createBuildId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function bootstrapProjectRepository(
  req: Request,
  project: StoredProject,
): Promise<{ metadata: ManifestMetadata; project: StoredProject }> {
  let current = await ensureProjectAssetsCached(project);
  const buildId = createBuildId();

  const manifestPath = getManifestFilePath(current.id, buildId);
  const manifestInitial = await renderManifest(current, buildId);

  await writeFile(manifestPath, manifestInitial, "utf-8");

  const metadata: ManifestMetadata = {
    lastBuildId: buildId,
    manifestPath,
    generatedAt: new Date().toISOString(),
  };

  if (current.repo) {
    const octokit = await getOctokitForRequest(req);
    const branch = current.repo.defaultBranch ?? current.defaultBranch ?? "main";
    const filesToCommit: Record<string, string> = {
      [`manifests/${buildId}.json`]: manifestInitial,
    };

    const definitionFiles = await collectProjectDefinitionFiles(current);
    for (const [path, content] of Object.entries(definitionFiles)) {
      filesToCommit[path] = content;
    }

    const renderedConfigs = await renderConfigFiles(current);
    for (const config of renderedConfigs) {
      filesToCommit[config.path] = config.content;
    }

    const { commitSha } = await commitFiles(octokit, {
      owner: current.repo.owner,
      repo: current.repo.name,
      branch,
      message: `chore: bootstrap project ${current.id} (${buildId})`,
      files: filesToCommit,
    });

    metadata.commitSha = commitSha;

    const manifestWithCommit = await renderManifest(current, buildId, {
      repository: {
        commit: commitSha,
      },
    });

    await writeFile(manifestPath, manifestWithCommit, "utf-8");
  }

  const updatedProject = (await recordManifestMetadata(current.id, metadata)) ?? current;
  current = updatedProject;

  return { metadata, project: current };
}

router.get("/", async (_req: Request, res: Response) => {
  const projects = await listProjects();
  res.json({ projects });
});

router.post("/", async (req: Request, res: Response) => {
  const { name, minecraftVersion, loader, description, repo, profilePath } = req.body ?? {};

  if (!name) {
    res.status(400).json({ error: "Project name is required" });
    return;
  }

  let repoMetadata: RepoMetadata | undefined;
  if (repo !== undefined) {
    const parsed = parseRepoPayload(repo);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    repoMetadata = parsed.repo;
  }

  const project = await createProject({
    name,
    minecraftVersion: minecraftVersion ?? "1.21.1",
    loader: loader ?? "paper",
    description,
    profilePath: typeof profilePath === "string" && profilePath ? profilePath : undefined,
    repo: repoMetadata,
  });

  let hydratedProject = project;
  if (repoMetadata) {
    try {
      const bootstrapped = await bootstrapProjectRepository(req, project);
      hydratedProject = bootstrapped.project;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorDetails = error instanceof Error 
        ? { message: error.message, stack: error.stack, name: error.name }
        : String(error);
      console.error("Failed to bootstrap project repository", errorDetails);
      const status = message.includes("GitHub session not available") ? 401 : 500;
      res
        .status(status)
        .json({ error: status === 401 ? "GitHub authentication required" : "Failed to initialize project repository" });
      return;
    }
  }

  const refreshed = (await findProject(project.id)) ?? hydratedProject;
  res.status(201).json({ project: toSummary(refreshed) });
});

router.post("/import", async (req: Request, res: Response) => {
  const { repoUrl, defaultBranch, profilePath, repo } = req.body ?? {};

  if (!profilePath) {
    res.status(400).json({ error: "profilePath is required" });
    return;
  }

  let repoMetadata: RepoMetadata | undefined;
  if (repo !== undefined) {
    const parsed = parseRepoPayload(repo);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    repoMetadata = parsed.repo;
  }

  const resolvedRepoUrl =
    (typeof repoUrl === "string" && repoUrl.length > 0 ? repoUrl : undefined) ?? repoMetadata?.htmlUrl;

  if (!resolvedRepoUrl) {
    res.status(400).json({ error: "Repository URL is required" });
    return;
  }

  const resolvedDefaultBranch =
    (typeof defaultBranch === "string" && defaultBranch.length > 0 ? defaultBranch : undefined) ??
    repoMetadata?.defaultBranch;

  if (!resolvedDefaultBranch) {
    res.status(400).json({ error: "defaultBranch is required" });
    return;
  }

  const project = await importProject({
    name: req.body?.name,
    repoUrl: resolvedRepoUrl,
    defaultBranch: resolvedDefaultBranch,
    profilePath,
    repo: repoMetadata,
  });

  let hydratedProject = project;
  if (repoMetadata) {
    try {
      const bootstrapped = await bootstrapProjectRepository(req, project);
      hydratedProject = bootstrapped.project;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorDetails = error instanceof Error 
        ? { message: error.message, stack: error.stack, name: error.name }
        : String(error);
      console.error("Failed to bootstrap imported project repository", errorDetails);
      const status = message.includes("GitHub session not available") ? 401 : 500;
      res
        .status(status)
        .json({ error: status === 401 ? "GitHub authentication required" : "Failed to initialize project repository" });
      return;
    }
  }

  const refreshed = (await findProject(project.id)) ?? hydratedProject;
  res.status(201).json({ project: toSummary(refreshed) });
});

router.get("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const project = await findProject(id);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.json({ project: toSummary(project) });
});

router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, minecraftVersion, loader, description } = req.body ?? {};

    const project = await findProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const updated = await updateProject(id, (p) => {
      if (typeof name === "string" && name.trim()) {
        p.name = name.trim();
      }
      if (typeof minecraftVersion === "string" && minecraftVersion.trim()) {
        p.minecraftVersion = minecraftVersion.trim();
      }
      if (typeof loader === "string" && loader.trim()) {
        p.loader = loader.trim();
      }
      if (typeof description === "string") {
        p.description = description.trim() || undefined;
      }
      return p;
    });

    if (!updated) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    res.json({ project: toSummary(updated) });
  } catch (error) {
    console.error("Failed to update project", error);
    res.status(500).json({ error: "Failed to update project" });
  }
});

router.post("/:id/assets", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const project = await setProjectAssets(id, {
      plugins: Array.isArray(req.body?.plugins)
        ? req.body.plugins.filter(
            (item: { id?: unknown; version?: unknown }) => Boolean(item?.id && item?.version),
          )
        : undefined,
      configs: Array.isArray(req.body?.configs)
        ? req.body.configs.filter((item: { path?: unknown }) => Boolean(item?.path))
        : undefined,
    });

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    res.status(200).json({
      project: {
        id: project.id,
        plugins: project.plugins ?? [],
        configs: project.configs ?? [],
      },
    });
  } catch (error) {
    console.error("Failed to update project assets", error);
    res.status(500).json({ error: "Failed to update project assets" });
  }
});

router.post("/:id/profile", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const project = await findProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const yaml = typeof req.body?.yaml === "string" ? req.body.yaml : undefined;
    if (!yaml || !yaml.trim()) {
      res.status(400).json({ error: "yaml content is required" });
      return;
    }

    const profilePath = project.profilePath?.trim() ? project.profilePath : "profiles/base.yml";
    const savedPath = await writeProjectFile(project, profilePath, yaml);

    const assets = await scanProjectAssets(project);
    const updated = await setProjectAssets(id, assets);

    res.status(201).json({
      profile: {
        path: savedPath,
      },
      project: {
        id,
        plugins: updated?.plugins ?? assets.plugins,
        configs: updated?.configs ?? assets.configs,
      },
    });
  } catch (error) {
    console.error("Failed to persist project profile", error);
    res.status(500).json({ error: "Failed to save project profile" });
  }
});

router.get("/:id/profile", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const project = await findProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const profilePath = project.profilePath?.trim() ? project.profilePath : "profiles/base.yml";
    const yaml = await readProjectFile(project, profilePath);

    if (!yaml) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    res.status(200).json({
      profile: {
        path: profilePath,
        yaml,
      },
    });
  } catch (error) {
    console.error("Failed to read project profile", error);
    res.status(500).json({ error: "Failed to read project profile" });
  }
});

async function syncProjectRepository(
  req: Request,
  project: StoredProject,
): Promise<{ commitSha: string }> {
  if (!project.repo) {
    throw new Error("Project does not have a linked repository");
  }

  const octokit = await getOctokitForRequest(req);
  const branch = project.repo.defaultBranch ?? project.defaultBranch ?? "main";
  
  const filesToCommit: Record<string, string> = {};

  // Collect project definition files (profile, overlays, plugin registry)
  const definitionFiles = await collectProjectDefinitionFiles(project);
  for (const [path, content] of Object.entries(definitionFiles)) {
    filesToCommit[path] = content;
  }

  // Collect uploaded config files (user-edited configs, NOT rendered template configs)
  const uploadedConfigs = await collectUploadedConfigMaterials(project);
  for (const config of uploadedConfigs) {
    filesToCommit[config.path] = config.content;
  }

  if (Object.keys(filesToCommit).length === 0) {
    throw new Error("No files to commit");
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const { commitSha } = await commitFiles(octokit, {
    owner: project.repo.owner,
    repo: project.repo.name,
    branch,
    message: `chore: sync project definition files (${timestamp})`,
    files: filesToCommit,
  });

  return { commitSha };
}

router.post("/:id/sync", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const project = await findProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!project.repo) {
      res.status(400).json({ error: "Project does not have a linked repository" });
      return;
    }

    const { commitSha } = await syncProjectRepository(req, project);

    res.status(200).json({
      commitSha,
      message: "Project definition files synced to repository",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errorDetails = error instanceof Error 
      ? { message: error.message, stack: error.stack, name: error.name }
      : String(error);
    console.error("Failed to sync project repository", errorDetails);
    const status = message.includes("GitHub session not available") 
      ? 401 
      : message.includes("does not have a linked repository")
      ? 400
      : message.includes("No files to commit")
      ? 400
      : 500;
    res
      .status(status)
      .json({ 
        error: status === 401 
          ? "GitHub authentication required" 
          : status === 400
          ? message
          : "Failed to sync project repository" 
      });
  }
});

router.post("/:id/scan", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const project = await findProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const assets = await scanProjectAssets(project);
    const updated = await setProjectAssets(id, assets);

    res.status(200).json({
      project: {
        id,
        plugins: updated?.plugins ?? [],
        configs: updated?.configs ?? [],
      },
    });
  } catch (error) {
    console.error("Failed to scan project assets", error);
    res.status(500).json({ error: "Failed to scan project assets" });
  }
});

router.post("/:id/plugins", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const project = await findProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const {
      pluginId,
      version,
      provider,
      source,
      downloadUrl,
      hash,
      minecraftVersionMin,
      minecraftVersionMax,
      cachePath,
    } = req.body ?? {};

    if (!pluginId || !version) {
      res.status(400).json({ error: "pluginId and version are required" });
      return;
    }

    let providerValue: PluginProvider | undefined;
    if (provider) {
      const normalized = String(provider).toLowerCase();
      const supported: PluginProvider[] = ["hangar", "modrinth", "spiget", "github", "custom"];
      if (!supported.includes(normalized as PluginProvider)) {
        res.status(400).json({ error: `Provider "${provider}" is not supported` });
        return;
      }
      providerValue = normalized as PluginProvider;
    }

    const coerceVersion = (value: unknown): string | undefined =>
      typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

    const normalizedMin = coerceVersion(minecraftVersionMin);
    const normalizedMax = coerceVersion(minecraftVersionMax);
    const sourceMin =
      coerceVersion(source?.minecraftVersionMin) ?? coerceVersion(source?.minecraftVersion);
    const sourceMax =
      coerceVersion(source?.minecraftVersionMax) ?? coerceVersion(source?.minecraftVersion);
    const fallbackVersion = coerceVersion(project.minecraftVersion);

    const finalMin = normalizedMin ?? sourceMin ?? fallbackVersion;
    const finalMax = normalizedMax ?? sourceMax ?? fallbackVersion;

    const resolvedProvider: PluginProvider | undefined =
      providerValue ?? (downloadUrl ? "custom" : undefined);

    if (!finalMin || !finalMax) {
      res.status(400).json({
        error: "Unable to determine compatible Minecraft version range for this plugin",
      });
      return;
    }

    const sourceRef: PluginSourceReference | undefined =
      source || downloadUrl
        ? {
            provider: resolvedProvider ?? "custom",
            slug: typeof source?.slug === "string" ? source.slug : pluginId,
            displayName: source?.displayName,
            projectUrl: source?.projectUrl,
            versionId: source?.versionId,
            downloadUrl: downloadUrl ?? source?.downloadUrl,
            loader: source?.loader,
            minecraftVersion: source?.minecraftVersion,
            minecraftVersionMin: finalMin,
            minecraftVersionMax: finalMax,
            sha256: hash ?? source?.sha256,
            cachePath: cachePath ?? source?.cachePath,
          }
        : source
        ? {
            provider: providerValue ?? source.provider,
            slug: typeof source.slug === "string" ? source.slug : pluginId,
            displayName: source.displayName,
            projectUrl: source.projectUrl,
            versionId: source.versionId,
            downloadUrl: source.downloadUrl,
            loader: source.loader,
            minecraftVersion: source.minecraftVersion,
            minecraftVersionMin: source.minecraftVersionMin ?? finalMin,
            minecraftVersionMax: source.minecraftVersionMax ?? finalMax,
            sha256: source.sha256,
            cachePath: source.cachePath ?? cachePath,
          }
        : undefined;

    const stored = await upsertStoredPlugin({
      id: pluginId,
      version,
      provider: sourceRef?.provider ?? resolvedProvider ?? providerValue,
      sha256: hash ?? sourceRef?.sha256,
      minecraftVersionMin: sourceRef?.minecraftVersionMin ?? finalMin,
      minecraftVersionMax: sourceRef?.minecraftVersionMax ?? finalMax,
      source: sourceRef,
      cachePath: cachePath ?? sourceRef?.cachePath,
    });

    const configDefinitions = stored.configDefinitions ?? [];
    const defaultMappings: ProjectPluginConfigMapping[] =
      configDefinitions.map((definition) => ({
        definitionId: definition.id,
        path: definition.path,
        requirement: definition.requirement,
      })) ?? [];

    const updatedProject =
      (await upsertProjectPlugin(id, {
        id: pluginId,
        version,
        provider: stored.provider ?? resolvedProvider ?? providerValue,
        minecraftVersionMin: stored.minecraftVersionMin ?? finalMin,
        minecraftVersionMax: stored.minecraftVersionMax ?? finalMax,
        cachePath: cachePath ?? stored.cachePath,
        source: stored.source ?? sourceRef,
        configMappings: defaultMappings,
      })) ?? project;

    const updatedPlugin = updatedProject.plugins?.find((entry) => entry.id === pluginId);
    if (updatedPlugin) {
      await reconcilePluginConfigMetadata(id, updatedProject, updatedPlugin, configDefinitions);
    }

    const refreshedProject = (await findProject(id)) ?? updatedProject;

    res.status(200).json({
      project: {
        id,
        plugins: refreshedProject.plugins ?? [],
      },
    });
  } catch (error) {
    console.error("Failed to add project plugin", error);
    res.status(500).json({ error: "Failed to add plugin" });
  }
});

router.post(
  "/:id/plugins/upload",
  pluginUpload.single("file"),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const project = await findProject(id);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const file = req.file;
      const { pluginId, version, minecraftVersionMin, minecraftVersionMax } = req.body ?? {};

      if (!file) {
        res.status(400).json({ error: "Plugin file is required" });
        return;
      }
      if (!pluginId || !version) {
        res.status(400).json({ error: "pluginId and version are required" });
        return;
      }

      const coerceVersion = (value: unknown): string | undefined =>
        typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
      const normalizedMin = coerceVersion(minecraftVersionMin) ?? coerceVersion(project.minecraftVersion);
      const normalizedMax = coerceVersion(minecraftVersionMax) ?? coerceVersion(project.minecraftVersion);

      if (!normalizedMin || !normalizedMax) {
        res.status(400).json({
          error: "Unable to determine compatible Minecraft version range for uploaded plugin",
        });
        return;
      }

      const safeName = sanitizeFileName(file.originalname || `${pluginId}-${version}.jar`);
      const relativePath = `plugins/uploads/${Date.now()}-${safeName}`;
      await writeProjectFileBuffer(project, relativePath, file.buffer);
      const sha256 = createHash("sha256").update(file.buffer).digest("hex");

      const stored = await upsertStoredPlugin({
        id: pluginId,
        version,
        provider: "custom",
        sha256,
        minecraftVersionMin: normalizedMin,
        minecraftVersionMax: normalizedMax,
        source: {
          provider: "custom",
          slug: pluginId,
          uploadPath: relativePath,
          sha256,
          minecraftVersionMin: normalizedMin,
          minecraftVersionMax: normalizedMax,
        },
      });
      const configDefinitions = stored.configDefinitions ?? [];
      const defaultMappings: ProjectPluginConfigMapping[] =
        configDefinitions.map((definition) => ({
          definitionId: definition.id,
          path: definition.path,
          requirement: definition.requirement,
        })) ?? [];

      const updatedProject =
        (await upsertProjectPlugin(id, {
          id: pluginId,
          version,
          provider: stored.provider ?? "custom",
          source: stored.source ?? {
            provider: "custom",
            slug: pluginId,
            uploadPath: relativePath,
            sha256,
            minecraftVersionMin: normalizedMin,
            minecraftVersionMax: normalizedMax,
          },
          minecraftVersionMin: stored.minecraftVersionMin ?? normalizedMin,
          minecraftVersionMax: stored.minecraftVersionMax ?? normalizedMax,
          cachePath: stored.cachePath,
          configMappings: defaultMappings,
        })) ?? project;

      const updatedPlugin = updatedProject.plugins?.find((entry) => entry.id === pluginId);
      if (updatedPlugin) {
        await reconcilePluginConfigMetadata(id, updatedProject, updatedPlugin, configDefinitions);
      }

      const refreshedProject = (await findProject(id)) ?? updatedProject;

      res.status(201).json({
        project: {
          id,
          plugins: refreshedProject.plugins ?? [],
        },
      });
    } catch (error) {
      console.error("Failed to upload plugin", error);
      res.status(500).json({ error: "Failed to upload plugin" });
    }
  },
);

router.post("/:id/manifest", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const project = await findProject(id);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const buildId = new Date().toISOString().replace(/[:.]/g, "-");

    const overrides: ManifestOverrides = {
      minecraft: req.body?.minecraft,
      world: req.body?.world,
      plugins: Array.isArray(req.body?.plugins) ? req.body.plugins : undefined,
      configs: Array.isArray(req.body?.configs) ? req.body.configs : undefined,
      artifact: req.body?.artifact,
      repository: req.body?.repository,
    };

    const manifestContent = await renderManifest(project, buildId, overrides);
    const manifestPath = getManifestFilePath(project.id, buildId);

    await writeFile(manifestPath, manifestContent, "utf-8");

    const metadata: ManifestMetadata = {
      lastBuildId: buildId,
      manifestPath,
      generatedAt: new Date().toISOString(),
    };

    await recordManifestMetadata(project.id, metadata);
    console.info("Manifest generated", {
      projectId: project.id,
      buildId,
      manifestPath,
    });

    res.status(201).json({ manifest: metadata, content: JSON.parse(manifestContent) });
  } catch (error) {
    console.error("Manifest generation failed", error);
    res.status(500).json({ error: "Manifest generation failed" });
  }
});

router.post("/:id/build", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    let project = await findProject(id);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const overrides: ManifestOverrides = {
      minecraft: req.body?.minecraft,
      world: req.body?.world,
      plugins: Array.isArray(req.body?.plugins) ? req.body.plugins : undefined,
      configs: Array.isArray(req.body?.configs) ? req.body.configs : undefined,
      artifact: req.body?.artifact,
      repository: req.body?.repository,
    };

    if (!project.plugins?.length || !project.configs?.length) {
      const scanned = await scanProjectAssets(project);
      project = (await setProjectAssets(project.id, scanned)) ?? project;
    }

    const job = await enqueueBuild(project, overrides, {
      githubToken: req.user?.accessToken,
    });
    res.status(202).json({ build: job });
  } catch (error) {
    console.error("Failed to queue build", error);
    res.status(500).json({ error: "Failed to queue build" });
  }
});

router.get("/:id/runs", async (req: Request, res: Response) => {
  const { id } = req.params;
  const runs = listRuns(id);
  res.json({ runs });
});

router.post("/:id/run", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const project = await findProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const run = await enqueueRun(project);
    res.status(202).json({ run });
  } catch (error) {
    console.error("Failed to trigger local run", error);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("already active")) {
      res.status(409).json({ error: message });
      return;
    }
    if (message.includes("No successful build")) {
      res.status(400).json({ error: message });
      return;
    }
    res.status(500).json({ error: "Failed to trigger local run" });
  }
});

router.post("/:id/run/reset-workspace", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const project = await findProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const result = await resetProjectWorkspace(project.id);
    res.status(200).json({ workspace: result });
  } catch (error) {
    console.error("Failed to reset workspace", error);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("active")) {
      res.status(409).json({ error: message });
      return;
    }
    res.status(500).json({ error: "Failed to reset workspace" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deleteRepo = Boolean(req.body?.deleteRepo);

    const project = await findProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (deleteRepo) {
      if (!project.repo) {
        res.status(400).json({ error: "Project does not have a linked repository" });
        return;
      }
      if (!req.user?.accessToken) {
        res.status(401).json({ error: "GitHub authentication required to delete repository" });
        return;
      }
    }

    if (deleteRepo && project.repo) {
      try {
        const octokit = await getOctokitForRequest(req);
        await octokit.repos.delete({
          owner: project.repo.owner,
          repo: project.repo.name,
        });
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (status === 404) {
          // Repo already gone; continue.
          console.warn(`Repository ${project.repo.fullName} already deleted.`);
        } else if (status === 403) {
          res
            .status(403)
            .json({ error: "GitHub token is missing delete_repo scope for repository deletion" });
          return;
        } else {
          console.error("Failed to delete GitHub repository", error);
          res.status(502).json({ error: "Failed to delete GitHub repository" });
          return;
        }
      }
    }

    await deleteProjectResources(project);
    await deleteProjectRecord(project.id);

    res.status(204).send();
  } catch (error) {
    console.error("Failed to delete project", error);
    res.status(500).json({ error: "Failed to delete project" });
  }
});

router.get("/:id/plugins/:pluginId/configs", async (req: Request, res: Response) => {
  try {
    const { id, pluginId } = req.params;
    const project = await findProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const plugin = project.plugins?.find((entry) => entry.id === pluginId);
    if (!plugin) {
      res.status(404).json({ error: "Plugin not found on project" });
      return;
    }
    const stored = plugin.version ? await findStoredPlugin(plugin.id, plugin.version) : undefined;
    const libraryDefinitions = stored?.configDefinitions ?? [];
    const uploadedSummaries = await listUploadedConfigFiles(project);
    
    // Also include scanned configs from project.configs that match this plugin
    const scannedSummaries: ConfigFileSummary[] = [];
    for (const config of project.configs ?? []) {
      if (config.pluginId === pluginId || (config.definitionId && libraryDefinitions.some(d => d.id === config.definitionId))) {
        // Check if it's already in uploadedSummaries
        if (!uploadedSummaries.some(s => s.path === config.path)) {
          // Try to get file stats - check both project directory and dev directory
          const projectRoot = join(getProjectsRoot(), project.id);
          const projectPath = join(projectRoot, config.path);
          
          let filePath: string | undefined;
          let stats: Awaited<ReturnType<typeof stat>> | undefined;
          
          // Check project directory first
          try {
            stats = await stat(projectPath);
            filePath = projectPath;
          } catch (error) {
            // If not in project directory, check dev directory (for Electron mode)
            if (process.env.ELECTRON_MODE === "true") {
              const devDataPaths = getDevDataPaths();
              for (const devDataPath of devDataPaths) {
                const devPath = join(devDataPath, "projects", project.id, config.path);
                try {
                  stats = await stat(devPath);
                  filePath = devPath;
                  break;
                } catch {
                  continue;
                }
              }
            }
          }
          
          if (stats && filePath) {
            scannedSummaries.push({
              path: config.path,
              size: Number(stats.size),
              modifiedAt: stats.mtime.toISOString(),
              sha256: config.sha256,
              pluginId: config.pluginId,
              definitionId: config.definitionId,
            });
          } else {
            // File doesn't exist, but still include it as a summary for matching purposes
            scannedSummaries.push({
              path: config.path,
              size: 0,
              modifiedAt: new Date().toISOString(),
              sha256: config.sha256,
              pluginId: config.pluginId,
              definitionId: config.definitionId,
            });
          }
        }
      }
    }
    
    const summaries = [...uploadedSummaries, ...scannedSummaries];
    
    const { definitions, unmatchedUploads } = buildPluginConfigViews(pluginId, plugin, libraryDefinitions, summaries);
    res.json({
      plugin: {
        id: plugin.id,
        version: plugin.version,
      },
      libraryDefinitions,
      mappings: plugin.configMappings ?? [],
      definitions,
      uploads: unmatchedUploads,
    });
  } catch (error) {
    console.error("Failed to load plugin config definitions", error);
    res.status(500).json({ error: "Failed to load plugin config definitions" });
  }
});

router.put("/:id/plugins/:pluginId/configs", async (req: Request, res: Response) => {
  try {
    const { id, pluginId } = req.params;
    const project = await findProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const plugin = project.plugins?.find((entry) => entry.id === pluginId);
    if (!plugin) {
      res.status(404).json({ error: "Plugin not found on project" });
      return;
    }

    const stored = plugin.version ? await findStoredPlugin(plugin.id, plugin.version) : undefined;
    const libraryDefinitions = stored?.configDefinitions ?? [];

    const rawMappings = Array.isArray(req.body?.mappings) ? req.body.mappings : [];
    if (!Array.isArray(rawMappings)) {
      res.status(400).json({ error: "mappings must be an array" });
      return;
    }

    const order: string[] = [];
    const mappingById = new Map<string, ProjectPluginConfigMapping>();

    for (const [index, raw] of rawMappings.entries()) {
      if (typeof raw !== "object" || raw === null) {
        res.status(400).json({ error: `mappings[${index}] must be an object` });
        return;
      }
      const definitionIdValue =
        typeof (raw as { definitionId?: unknown }).definitionId === "string"
          ? (raw as { definitionId: string }).definitionId.trim()
          : "";
      if (!definitionIdValue) {
        res.status(400).json({ error: `mappings[${index}].definitionId is required` });
        return;
      }

      let pathValue: string | undefined;
      try {
        pathValue = sanitizeOptionalConfigPath((raw as { path?: unknown }).path);
      } catch (error) {
        res.status(400).json({
          error:
            error instanceof Error
              ? `mappings[${index}].path: ${error.message}`
              : `Invalid path for mappings[${index}]`,
        });
        return;
      }

      let requirementValue: PluginConfigRequirement | undefined;
      if ("requirement" in (raw as Record<string, unknown>)) {
        try {
          requirementValue = normalizeRequirement((raw as { requirement?: unknown }).requirement, "optional");
        } catch (error) {
          res.status(400).json({
            error:
              error instanceof Error
                ? `mappings[${index}].requirement: ${error.message}`
                : `Invalid requirement for mappings[${index}]`,
          });
          return;
        }
      }

      const notesValue =
        typeof (raw as { notes?: unknown }).notes === "string"
          ? (raw as { notes: string }).notes.trim() || undefined
          : undefined;

      const labelValue =
        typeof (raw as { label?: unknown }).label === "string"
          ? (raw as { label: string }).label.trim() || undefined
          : undefined;

      const normalized: ProjectPluginConfigMapping = {
        definitionId: definitionIdValue,
        label: labelValue,
        path: pathValue,
        requirement: requirementValue,
        notes: notesValue,
      };
      if (!order.includes(definitionIdValue)) {
        order.push(definitionIdValue);
      }
      mappingById.set(definitionIdValue, normalized);
    }

    const normalizedMappings: ProjectPluginConfigMapping[] = order
      .map((idValue) => mappingById.get(idValue))
      .filter((mapping): mapping is ProjectPluginConfigMapping => Boolean(mapping));

    const updatedProject =
      (await upsertProjectPlugin(id, {
        id: plugin.id,
        version: plugin.version,
        configMappings: normalizedMappings,
      })) ?? project;

    const updatedPlugin = updatedProject.plugins?.find((entry) => entry.id === pluginId);
    if (!updatedPlugin) {
      res.status(500).json({ error: "Failed to update plugin config mappings" });
      return;
    }

    await reconcilePluginConfigMetadata(id, updatedProject, updatedPlugin, libraryDefinitions);
    const finalProject = (await findProject(id)) ?? updatedProject;
    const finalPlugin = finalProject.plugins?.find((entry) => entry.id === pluginId);
    if (!finalPlugin) {
      res.status(500).json({ error: "Failed to load updated plugin configuration" });
      return;
    }

    const summaries = await listUploadedConfigFiles(finalProject);
    const { definitions, unmatchedUploads } = buildPluginConfigViews(pluginId, finalPlugin, libraryDefinitions, summaries);

    res.json({
      plugin: {
        id: finalPlugin.id,
        version: finalPlugin.version,
      },
      libraryDefinitions,
      mappings: finalPlugin.configMappings ?? [],
      definitions,
      uploads: unmatchedUploads,
    });
  } catch (error) {
    console.error("Failed to update plugin config mappings", error);
    res.status(500).json({ error: "Failed to update plugin config mappings" });
  }
});

router.get("/:id/configs", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const project = await findProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const configs = await listUploadedConfigFiles(project);
    res.json({ configs });
  } catch (error) {
    console.error("Failed to list project configs", error);
    res.status(500).json({ error: "Failed to list project configs" });
  }
});

router.get("/:id/configs/file", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const path = typeof req.query.path === "string" ? req.query.path : undefined;
    const project = await findProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!path) {
      res.status(400).json({ error: "path query parameter is required" });
      return;
    }
    const file = await readUploadedConfigFile(project, path);
    res.json({ file });
  } catch (error) {
    console.error("Failed to read config file", error);
    res.status(500).json({ error: "Failed to read config file" });
  }
});

async function updateProjectConfigMetadata(
  projectId: string,
  project: StoredProject,
  configPath: string,
  sha256: string,
  pluginId?: string,
  definitionId?: string,
): Promise<void> {
  const currentConfigs = project.configs ?? [];
  const nextConfigs = currentConfigs.filter((entry) => entry.path !== configPath);
  const entry = {
    path: configPath,
    sha256,
    pluginId,
    definitionId,
  };
  nextConfigs.push(entry);
  nextConfigs.sort((a, b) => a.path.localeCompare(b.path));
  await setProjectAssets(projectId, { configs: nextConfigs });
}

async function removeProjectConfigMetadata(projectId: string, project: StoredProject, configPath: string): Promise<void> {
  const currentConfigs = project.configs ?? [];
  const nextConfigs = currentConfigs.filter((entry) => entry.path !== configPath);
  if (nextConfigs.length === currentConfigs.length) {
    return;
  }
  await setProjectAssets(projectId, { configs: nextConfigs });
}

router.post(
  "/:id/configs/upload",
  configUpload.single("file"),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const project = await findProject(id);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const file = req.file;
      const relativePath = typeof req.body?.relativePath === "string" ? req.body.relativePath : "";

      if (!file) {
        res.status(400).json({ error: "Config file is required" });
        return;
      }
      if (!relativePath.trim()) {
        res.status(400).json({ error: "relativePath is required" });
        return;
      }

      const pluginIdRaw =
        typeof req.body?.pluginId === "string" ? req.body.pluginId.trim() : "";
      const definitionIdRaw =
        typeof req.body?.definitionId === "string" ? req.body.definitionId.trim() : "";
      const pluginIdValue = pluginIdRaw.length > 0 ? pluginIdRaw : undefined;
      const definitionIdValue = definitionIdRaw.length > 0 ? definitionIdRaw : undefined;

      const saved = await saveUploadedConfigFile(project, relativePath, file.buffer);
      const derivedMapping =
        pluginIdValue || definitionIdValue
          ? undefined
          : findPluginMappingForPath(project, saved.path);
      await updateProjectConfigMetadata(
        id,
        project,
        saved.path,
        saved.sha256,
        pluginIdValue ?? derivedMapping?.pluginId,
        definitionIdValue ?? derivedMapping?.definitionId,
      );
      const refreshed = (await findProject(id)) ?? project;
      const configs = await listUploadedConfigFiles(refreshed);
      res.status(201).json({ configs });
    } catch (error) {
      console.error("Failed to upload config file", error);
      const message = error instanceof Error ? error.message : "Failed to upload config file";
      const status = message.toLowerCase().includes("relativepath") ? 400 : 500;
      res.status(status).json({ error: message });
    }
  },
);

router.put("/:id/configs/file", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { path, content, pluginId: pluginIdInput, definitionId: definitionIdInput } = req.body ?? {};
    const project = await findProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
  }
    if (typeof path !== "string" || typeof content !== "string") {
      res.status(400).json({ error: "path and content are required" });
      return;
    }
    const pluginIdOverride =
      typeof pluginIdInput === "string" && pluginIdInput.trim().length > 0
        ? pluginIdInput.trim()
        : undefined;
    const definitionIdOverride =
      typeof definitionIdInput === "string" && definitionIdInput.trim().length > 0
        ? definitionIdInput.trim()
        : undefined;
    const existingEntry = (project.configs ?? []).find((entry) => entry.path === path);
    const derivedMapping =
      pluginIdOverride || definitionIdOverride
        ? undefined
        : findPluginMappingForPath(project, path);
    const saved = await overwriteUploadedConfigFile(project, path, content);
    await updateProjectConfigMetadata(
      id,
      project,
      saved.path,
      saved.sha256,
      pluginIdOverride ?? existingEntry?.pluginId ?? derivedMapping?.pluginId,
      definitionIdOverride ?? existingEntry?.definitionId ?? derivedMapping?.definitionId,
    );
    res.json({ success: true });
  } catch (error) {
    console.error("Failed to update config file", error);
    const message = error instanceof Error ? error.message : "Failed to update config file";
    const status = message.toLowerCase().includes("relativepath") ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

router.delete("/:id/configs/file", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { path } = req.query;
    const project = await findProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (typeof path !== "string" || path.trim().length === 0) {
      res.status(400).json({ error: "path query parameter is required" });
      return;
    }
    try {
      await deleteUploadedConfigFile(project, path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        res.status(404).json({ error: "Config file not found" });
        return;
      }
      throw error;
    }
    await removeProjectConfigMetadata(id, project, path);
    const refreshed = (await findProject(id)) ?? project;
    const configs = await listUploadedConfigFiles(refreshed);
    res.status(200).json({ configs });
  } catch (error) {
    console.error("Failed to delete config file", error);
    res.status(500).json({ error: "Failed to delete config file" });
  }
});

router.delete("/:id/plugins/:pluginId", async (req: Request, res: Response) => {
  try {
    const { id, pluginId } = req.params;
    const project = await findProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const updated = await removeProjectPlugin(id, pluginId);
    res.json({
      project: {
        id,
        plugins: updated?.plugins ?? [],
      },
    });
  } catch (error) {
    console.error("Failed to delete project plugin", error);
    res.status(500).json({ error: "Failed to delete project plugin" });
  }
});

export default router;

