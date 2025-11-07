import type { Request, Response } from "express";
import { Router } from "express";
import { createProject, findProject, importProject, listProjects } from "../storage/projectsStore";
import type { ProjectSummary } from "../types/projects";
import type { StoredProject } from "../types/storage";

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

export default router;

