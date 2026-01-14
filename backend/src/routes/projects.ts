import type { Request, Response } from "express";
import { Router } from "express";
import { writeFile, stat, unlink } from "fs/promises";
import { existsSync } from "fs";
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
  sanitizeRelativePath,
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

interface PluginConfigDefinitionView {
  id: string;
  type: 'library' | 'custom';  // NEW
  source: 'library' | 'custom';  // Keep for backward compat, same as type
  label?: string;
  description?: string;
  tags?: string[];
  defaultPath: string;
  resolvedPath: string;
  notes?: string;
  mapping?: ProjectPluginConfigMapping;
  uploaded?: ConfigFileSummary;
}

// Type guard to check if mapping is new format (discriminated union)
function isNewFormatMapping(mapping: ProjectPluginConfigMapping): mapping is Extract<ProjectPluginConfigMapping, { type: 'library' }> | Extract<ProjectPluginConfigMapping, { type: 'custom' }> {
  return 'type' in mapping && (mapping.type === 'library' || mapping.type === 'custom');
}

// Helper to get definitionId from old or new format
function getDefinitionId(mapping: ProjectPluginConfigMapping): string {
  if (isNewFormatMapping(mapping)) {
    return mapping.type === 'library' ? mapping.definitionId : mapping.customId;
  }
  // Old format
  return (mapping as any).definitionId;
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
    const id = getDefinitionId(mapping);
    mappingById.set(id, mapping);
  }

  const relevantDefinitionIds = new Set<string>([
    ...libraryDefinitions.map((definition) => definition.id),
    ...mappings.map((mapping) => getDefinitionId(mapping)),
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
    // Library configs: ALWAYS use definition.path, never mapping.path
    const resolvedPath = definition.path;  // No override allowed
    const uploaded = resolveUpload(definition.id, resolvedPath);
    if (uploaded) {
      matchedSummaries.add(uploaded);
    }
    
    // Handle migration: old format without type field
    let normalizedMapping: ProjectPluginConfigMapping | undefined;
    if (mapping) {
      if (isNewFormatMapping(mapping) && mapping.type === 'library') {
        normalizedMapping = {
          type: 'library',
          definitionId: definition.id,
          notes: mapping.notes,
        };
      } else if (isNewFormatMapping(mapping) && mapping.type === 'custom') {
        // This shouldn't happen for library definitions, but handle gracefully
        continue;
      } else {
        // Old format: treat as library mapping
        const oldMapping = mapping as any;
        normalizedMapping = {
          type: 'library',
          definitionId: definition.id,
          notes: oldMapping.notes,
        };
      }
    }
    
    views.push({
      id: definition.id,
      type: 'library',
      source: 'library',
      label: definition.label,
      description: definition.description,
      tags: definition.tags,
      defaultPath: definition.path,
      resolvedPath,  // Always same as defaultPath for library
      notes: normalizedMapping?.notes,
      mapping: normalizedMapping,
      uploaded,
    });
  }

  for (const mapping of mappings) {
    const mappingDefId = getDefinitionId(mapping);
    
    // Skip if this is already handled as a library config
    if (definitionMap.has(mappingDefId)) {
      continue;
    }
    
    // Determine if this is a custom config
    // Migration: old format without type field - treat as custom if not in library
    const isCustom = isNewFormatMapping(mapping) && mapping.type === 'custom' || 
                     (!isNewFormatMapping(mapping) && !definitionMap.has(mappingDefId));
    
    if (!isCustom) {
      continue;  // Skip non-custom mappings that aren't in library
    }
    
    // For custom configs, path is required
    // Old format: use definitionId as customId if it starts with 'custom/'
    // New format: use customId field
    let customId: string;
    let resolvedPath: string;
    let label: string;
    let notes: string | undefined;
    
    if (isNewFormatMapping(mapping) && mapping.type === 'custom') {
      customId = mapping.customId;
      resolvedPath = mapping.path;
      label = mapping.label;
      notes = mapping.notes;
    } else {
      // Old format
      const oldMapping = mapping as any;
      customId = oldMapping.definitionId.startsWith('custom/')
        ? oldMapping.definitionId
        : `custom/${oldMapping.definitionId}`;
      resolvedPath = oldMapping.path ?? '';
      label = oldMapping.label ?? customId;
      notes = oldMapping.notes;
    }
    
    if (!resolvedPath) {
      continue;  // Invalid custom config without path
    }
    
    const uploaded = resolveUpload(customId, resolvedPath);
    if (uploaded) {
      matchedSummaries.add(uploaded);
    }
    
    views.push({
      id: customId,
      type: 'custom',
      source: 'custom',
      label,
      description: undefined,
      tags: undefined,
      defaultPath: resolvedPath,
      resolvedPath,
      notes,
      mapping: {
        type: 'custom',
        customId,
        label,
        path: resolvedPath,
        notes,
      },
      uploaded,
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
      // Handle new format (discriminated union)
      if ('type' in mapping) {
        if (mapping.type === 'custom' && mapping.path === path) {
          return { pluginId: plugin.id, definitionId: mapping.customId };
        } else if (mapping.type === 'library') {
          // Library configs use definition path, check against stored plugin definition
          // This is handled elsewhere, skip here
          continue;
        }
      } else {
        // Old format: check path
        const oldMapping = mapping as any;
        if (oldMapping.path === path) {
          return { pluginId: plugin.id, definitionId: oldMapping.definitionId };
        }
      }
    }
  }
  return undefined;
}

// Helper function to find library definition for a given path
async function findLibraryDefinitionForPath(
  project: StoredProject,
  path: string,
): Promise<{ pluginId: string; definitionId: string; label?: string } | undefined> {
  for (const plugin of project.plugins ?? []) {
    if (!plugin.version) continue;
    
    const stored = await findStoredPlugin(plugin.id, plugin.version);
    if (!stored?.configDefinitions) continue;
    
    for (const definition of stored.configDefinitions) {
      if (definition.path === path) {
        return {
          pluginId: plugin.id,
          definitionId: definition.id,
          label: definition.label,
        };
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
    const id = getDefinitionId(mapping);
    mappingById.set(id, mapping);
  }

  const resolvedPathMap = new Map<string, { pluginId: string; definitionId: string }>();
  for (const definition of libraryDefinitions) {
    const mapping = mappingById.get(definition.id);
    // Library configs always use definition.path (no override)
    const resolvedPath = definition.path;
    if (resolvedPath) {
      resolvedPathMap.set(resolvedPath, { pluginId: plugin.id, definitionId: definition.id });
    }
  }
  for (const mapping of mappings) {
    // Only custom mappings have paths
    if ('type' in mapping && mapping.type === 'custom') {
      resolvedPathMap.set(mapping.path, { pluginId: plugin.id, definitionId: mapping.customId });
    } else if (!('type' in mapping)) {
      // Old format
      const oldMapping = mapping as any;
      if (oldMapping.path) {
        resolvedPathMap.set(oldMapping.path, { pluginId: plugin.id, definitionId: oldMapping.definitionId });
      }
    }
  }

  const knownDefinitionIds = new Set<string>([
    ...libraryDefinitions.map((definition) => definition.id),
    ...mappings.map((mapping) => getDefinitionId(mapping)),
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
        type: 'library',
        definitionId: definition.id,
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
          type: 'library',
          definitionId: definition.id,
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

    const options = {
      resetWorld: Boolean(req.body?.resetWorld),
      resetPlugins: Boolean(req.body?.resetPlugins),
    };

    const run = await enqueueRun(project, options);
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
      
      // Parse type field
      const typeValue = (raw as { type?: unknown }).type;
      if (typeValue !== 'library' && typeValue !== 'custom') {
        res.status(400).json({ error: `mappings[${index}].type must be 'library' or 'custom'` });
        return;
      }

      const notesValue =
        typeof (raw as { notes?: unknown }).notes === "string"
          ? (raw as { notes: string }).notes.trim() || undefined
          : undefined;

      let normalized: ProjectPluginConfigMapping;
      let orderKey: string;

      if (typeValue === 'library') {
        // Library mapping validation
        const definitionIdValue =
          typeof (raw as { definitionId?: unknown }).definitionId === "string"
            ? (raw as { definitionId: string }).definitionId.trim()
            : "";
        if (!definitionIdValue) {
          res.status(400).json({ error: `mappings[${index}].definitionId is required for library type` });
          return;
        }
        // Validate definitionId references library definition
        if (!libraryDefinitions.some(d => d.id === definitionIdValue)) {
          res.status(400).json({ error: `mappings[${index}].definitionId must reference a library definition` });
          return;
        }
        // Reject path if provided (library configs can't override path)
        if ((raw as { path?: unknown }).path !== undefined) {
          res.status(400).json({ error: `mappings[${index}].path cannot be provided for library type` });
          return;
        }
        normalized = {
          type: 'library',
          definitionId: definitionIdValue,
          notes: notesValue,
        };
        orderKey = definitionIdValue;
      } else {
        // Custom mapping validation
        const pathValue = (raw as { path?: unknown }).path;
        if (typeof pathValue !== "string" || pathValue.trim().length === 0) {
          res.status(400).json({ error: `mappings[${index}].path is required for custom type` });
          return;
        }
        let sanitizedPath: string;
        try {
          sanitizedPath = sanitizeConfigPathStrict(pathValue.trim());
        } catch (error) {
          res.status(400).json({
            error:
              error instanceof Error
                ? `mappings[${index}].path: ${error.message}`
                : `Invalid path for mappings[${index}]`,
          });
          return;
        }
        
        const labelValue =
          typeof (raw as { label?: unknown }).label === "string"
            ? (raw as { label: string }).label.trim()
            : undefined;
        if (!labelValue) {
          res.status(400).json({ error: `mappings[${index}].label is required for custom type` });
          return;
        }
        
        // Generate customId if not provided
        const customIdValue = typeof (raw as { customId?: unknown }).customId === "string"
          ? (raw as { customId: string }).customId.trim()
          : `custom/${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        
        normalized = {
          type: 'custom',
          customId: customIdValue,
          label: labelValue,
          path: sanitizedPath,
          notes: notesValue,
        };
        orderKey = customIdValue;
      }
      
      if (!order.includes(orderKey)) {
        order.push(orderKey);
      }
      mappingById.set(orderKey, normalized);
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

async function listAllProjectConfigs(project: StoredProject): Promise<ConfigFileSummary[]> {
  const uploadedSummaries = await listUploadedConfigFiles(project);
  const uploadedPaths = new Set(uploadedSummaries.map(s => s.path));
  
  // Also include scanned configs from project.configs that aren't already in uploadedSummaries
  const scannedSummaries: ConfigFileSummary[] = [];
  for (const config of project.configs ?? []) {
    // Skip if already in uploaded summaries
    if (uploadedPaths.has(config.path)) {
      continue;
    }
    
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
      // File doesn't exist, but still include it as a summary
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
  
  const allSummaries = [...uploadedSummaries, ...scannedSummaries];
  allSummaries.sort((a, b) => a.path.localeCompare(b.path));
  return allSummaries;
}

router.get("/:id/configs", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const project = await findProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const configs = await listAllProjectConfigs(project);
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

      const typeValue = typeof req.body?.type === "string" ? req.body.type : undefined;
      const customIdValue = typeof req.body?.customId === "string" ? req.body.customId.trim() : undefined;
      const labelValue = typeof req.body?.label === "string" ? req.body.label.trim() : undefined;
      
      // Validate based on type
      if (typeValue === 'custom') {
        // Check if path conflicts with library definition
        const libraryConflict = await findLibraryDefinitionForPath(project, relativePath);
        if (libraryConflict) {
          res.status(400).json({
            error: `Path "${relativePath}" matches a library config template for plugin "${libraryConflict.pluginId}" (${libraryConflict.label || libraryConflict.definitionId}). Please use "Use Config Template" mode instead.`,
          });
          return;
        }
        
        if (!labelValue) {
          res.status(400).json({ error: "label is required for custom config" });
          return;
        }
      } else if (typeValue === 'library') {
        if (!definitionIdValue) {
          res.status(400).json({ error: "definitionId is required for library config" });
          return;
        }
        
        // Validate path matches library definition
        const plugin = project.plugins?.find((p) => p.id === pluginIdValue);
        if (plugin?.version) {
          const stored = await findStoredPlugin(plugin.id, plugin.version);
          const definition = stored?.configDefinitions?.find((d) => d.id === definitionIdValue);
          if (definition && definition.path !== relativePath) {
            res.status(400).json({
              error: `Path must match library template path: "${definition.path}"`,
            });
            return;
          }
        }
      }

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
      
      // Automatically create/update configMappings if plugin and type are provided
      if (pluginIdValue && typeValue) {
        const plugin = project.plugins?.find((p) => p.id === pluginIdValue);
        if (plugin) {
          const existingMappings = plugin.configMappings ?? [];
          let needsUpdate = false;
          let updatedMappings = [...existingMappings];
          
          if (typeValue === 'library' && definitionIdValue) {
            // Check if library mapping already exists
            const hasMapping = existingMappings.some((m) => {
              if ('type' in m && m.type === 'library') {
                return m.definitionId === definitionIdValue;
              }
              // Old format
              return (m as any).definitionId === definitionIdValue;
            });
            
            if (!hasMapping) {
              // Create new library mapping
              const newMapping: ProjectPluginConfigMapping = {
                type: 'library',
                definitionId: definitionIdValue,
              };
              updatedMappings.push(newMapping);
              needsUpdate = true;
            }
          } else if (typeValue === 'custom' && customIdValue && labelValue) {
            // Check if custom mapping already exists
            const hasMapping = existingMappings.some((m) => {
              if ('type' in m && m.type === 'custom') {
                return m.customId === customIdValue;
              }
              // Old format - check by path or definitionId
              const oldMapping = m as any;
              return oldMapping.definitionId === customIdValue || oldMapping.path === relativePath;
            });
            
            if (!hasMapping) {
              // Create new custom mapping
              const newMapping: ProjectPluginConfigMapping = {
                type: 'custom',
                customId: customIdValue,
                label: labelValue,
                path: relativePath,
              };
              updatedMappings.push(newMapping);
              needsUpdate = true;
            } else {
              // Update existing custom mapping if path changed
              updatedMappings = existingMappings.map((m) => {
                if ('type' in m && m.type === 'custom' && m.customId === customIdValue) {
                  if (m.path !== relativePath || m.label !== labelValue) {
                    needsUpdate = true;
                    return {
                      type: 'custom',
                      customId: customIdValue,
                      label: labelValue,
                      path: relativePath,
                      notes: m.notes,
                    };
                  }
                }
                return m;
              });
            }
          }
          
          if (needsUpdate) {
            const updatedProject = await upsertProjectPlugin(id, {
              ...plugin,
              configMappings: updatedMappings,
            });
            if (updatedProject) {
              const updatedPlugin = updatedProject.plugins?.find((p) => p.id === pluginIdValue);
              if (updatedPlugin && plugin.version) {
                const stored = await findStoredPlugin(plugin.id, plugin.version);
                const libraryDefinitions = stored?.configDefinitions ?? [];
                // Reconcile metadata to sync configs array with new mappings
                await reconcilePluginConfigMetadata(id, updatedProject, updatedPlugin, libraryDefinitions);
              }
            }
          }
        }
      }
      
      const refreshed = (await findProject(id)) ?? project;
      const configs = await listAllProjectConfigs(refreshed);
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
    
    const sanitized = sanitizeRelativePath(path);
    
    // Find the config entry BEFORE removing it to check if it's a custom config
    const configEntry = (project.configs ?? []).find((entry) => entry.path === sanitized);
    
    // If it's a custom config, remove from configMappings as well
    if (configEntry?.pluginId && configEntry?.definitionId && configEntry.definitionId.startsWith('custom/')) {
      const plugin = project.plugins?.find((p) => p.id === configEntry.pluginId);
      if (plugin) {
        const currentMappings = plugin.configMappings ?? [];
        const updatedMappings = currentMappings.filter((mapping) => {
          // Remove custom mappings that match this definitionId
          if (isNewFormatMapping(mapping) && mapping.type === 'custom') {
            return mapping.customId !== configEntry.definitionId;
          }
          // Old format: check if definitionId matches and path matches (for custom configs)
          const oldMapping = mapping as any;
          if (oldMapping.definitionId === configEntry.definitionId) {
            // Only remove if path matches (to avoid removing library configs)
            return oldMapping.path !== sanitized;
          }
          return true;
        });
        
        // Only update if mappings changed
        if (updatedMappings.length !== currentMappings.length) {
          await upsertProjectPlugin(id, {
            ...plugin,
            configMappings: updatedMappings,
          });
        }
      }
    }
    
    // Delete from config/uploads (staging area) - this is the source of truth
    // This file persists after builds and is used by materializeConfigs()
    try {
      await deleteUploadedConfigFile(project, path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Handle file not found and directory errors gracefully - these don't prevent metadata removal
      if (code !== "ENOENT" && code !== "EISDIR" && code !== "ERR_FS_EISDIR") {
        // Only throw if it's not a "file not found" or "is a directory" error
        throw error;
      }
      // ENOENT/EISDIR are fine - file might not exist or might be a directory in staging area
    }
    
    // Also delete from materialized location (where server reads from at runtime)
    // This is written during builds by materializeConfigs() via writeProjectFileBuffer()
    // Both locations can exist simultaneously, so we need to clean up both
    const projectRoot = join(getProjectsRoot(), project.id);
    const projectPath = join(projectRoot, sanitized);
    
    let filePath: string | undefined;
    if (existsSync(projectPath)) {
      filePath = projectPath;
    } else {
      // Also check dev directory paths
      const devDataPaths = getDevDataPaths();
      for (const devDataPath of devDataPaths) {
        const devPath = join(devDataPath, "projects", project.id, sanitized);
        if (existsSync(devPath)) {
          filePath = devPath;
          break;
        }
      }
    }
    
    if (filePath) {
      try {
        await unlink(filePath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
          // Only throw if it's not a "file not found" error
          throw error;
        }
        // ENOENT is fine - file might not exist in materialized location
      }
    }
    
    // Always remove metadata entry, even if file wasn't found
    // (file might have been manually deleted or never existed)
    await removeProjectConfigMetadata(id, project, sanitized);
    
    const refreshed = (await findProject(id)) ?? project;
    const configs = await listAllProjectConfigs(refreshed);
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

