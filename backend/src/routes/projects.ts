import type { Request, Response } from "express";
import { Router } from "express";
import { writeFile } from "fs/promises";
import { createProject, findProject, importProject, listProjects, getManifestFilePath, recordManifestMetadata } from "../storage/projectsStore";
import type { ProjectSummary } from "../types/projects";
import type { ManifestMetadata } from "../types/storage";
import { renderManifest } from "../services/manifestService";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  const projects = await listProjects();
  res.json({ projects });
});

router.post("/", async (req: Request, res: Response) => {
  const { name, minecraftVersion, loader, description } = req.body ?? {};

  if (!name) {
    res.status(400).json({ error: "Project name is required" });
    return;
  }

  const project = await createProject({
    name,
    minecraftVersion: minecraftVersion ?? "1.21.1",
    loader: loader ?? "paper",
    description,
  });

  const summary: ProjectSummary = {
    id: project.id,
    name: project.name,
    description: project.description,
    minecraftVersion: project.minecraftVersion,
    loader: project.loader,
    updatedAt: project.updatedAt,
    source: project.source,
    manifest: project.manifest,
  };

  res.status(201).json({ project: summary });
});

router.post("/import", async (req: Request, res: Response) => {
  const { repoUrl, defaultBranch, profilePath } = req.body ?? {};

  if (!repoUrl) {
    res.status(400).json({ error: "Repository URL is required" });
    return;
  }

  if (!defaultBranch || !profilePath) {
    res.status(400).json({ error: "defaultBranch and profilePath are required" });
    return;
  }

  const project = await importProject({
    name: req.body?.name,
    repoUrl,
    defaultBranch,
    profilePath,
  });

  const summary: ProjectSummary = {
    id: project.id,
    name: project.name,
    description: project.description,
    minecraftVersion: project.minecraftVersion,
    loader: project.loader,
    updatedAt: project.updatedAt,
    source: project.source,
    manifest: project.manifest,
  };

  res.status(201).json({ project: summary });
});

router.get("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const project = await findProject(id);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const summary: ProjectSummary = {
    id: project.id,
    name: project.name,
    description: project.description,
    minecraftVersion: project.minecraftVersion,
    loader: project.loader,
    updatedAt: project.updatedAt,
    source: project.source,
  };

  res.json({ project: summary });
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
    const manifestContent = await renderManifest(project, buildId);
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

export default router;

