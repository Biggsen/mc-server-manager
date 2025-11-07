import type { Request, Response } from "express";
import { Router } from "express";
import type { ProjectSummary } from "../types/projects";

const router = Router();

const mockProjects: ProjectSummary[] = [
  {
    id: "demo-project",
    name: "Demo Project",
    description: "Placeholder project definition",
    minecraftVersion: "1.21.1",
    loader: "paper",
    updatedAt: new Date().toISOString(),
  },
];

router.get("/", (_req: Request, res: Response) => {
  res.json({ projects: mockProjects });
});

router.post("/", (req: Request, res: Response) => {
  const { name, minecraftVersion, loader } = req.body ?? {};

  if (!name) {
    res.status(400).json({ error: "Project name is required" });
    return;
  }

  const created: ProjectSummary = {
    id: name.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
    name,
    minecraftVersion: minecraftVersion ?? "1.21.1",
    loader: loader ?? "paper",
    description: req.body?.description ?? "",
    updatedAt: new Date().toISOString(),
  };

  res.status(202).json({ project: created, status: "queued" });
});

router.get("/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const project = mockProjects.find((entry) => entry.id === id);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.json({ project });
});

export default router;

