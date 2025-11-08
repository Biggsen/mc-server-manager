import type { Request, Response } from "express";
import { Router } from "express";
import { writeFile } from "fs/promises";
import {
  createProject,
  findProject,
  importProject,
  listProjects,
  getManifestFilePath,
  recordManifestMetadata,
  setProjectAssets,
  upsertProjectPlugin,
} from "../storage/projectsStore";
import type { ProjectSummary } from "../types/projects";
import type { ManifestMetadata, RepoMetadata, StoredProject } from "../types/storage";
import type { PluginProvider, PluginSourceReference } from "../types/plugins";
import { renderManifest, type ManifestOverrides } from "../services/manifestService";
import { enqueueBuild } from "../services/buildQueue";
import { scanProjectAssets } from "../services/projectScanner";
import { commitFiles, getOctokitForRequest } from "../services/githubClient";
import {
  collectProjectDefinitionFiles,
  renderConfigFiles,
} from "../services/projectFiles";
import { enqueueRun, listRuns } from "../services/runQueue";

const router = Router();

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
    const octokit = getOctokitForRequest(req);
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
      console.error("Failed to bootstrap project repository", error);
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
      console.error("Failed to bootstrap imported project repository", error);
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

    const { pluginId, version, provider, source } = req.body ?? {};

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

    let sourceRef: PluginSourceReference | undefined;
    if (source && providerValue) {
      sourceRef = {
        provider: providerValue,
        slug: typeof source.slug === "string" ? source.slug : pluginId,
        displayName: source.displayName,
        projectUrl: source.projectUrl,
        versionId: source.versionId,
        downloadUrl: source.downloadUrl,
        loader: source.loader,
        minecraftVersion: source.minecraftVersion,
      };
    }

    const updated = await upsertProjectPlugin(id, {
      id: pluginId,
      version,
      provider: providerValue,
      source: sourceRef,
    });

    res.status(200).json({
      project: {
        id,
        plugins: updated?.plugins ?? [],
      },
    });
  } catch (error) {
    console.error("Failed to add project plugin", error);
    res.status(500).json({ error: "Failed to add plugin" });
  }
});

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
      githubToken: req.session.github?.accessToken,
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
    res.status(500).json({ error: "Failed to trigger local run" });
  }
});

export default router;

