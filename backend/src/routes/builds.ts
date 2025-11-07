import type { Request, Response } from "express";
import { Router } from "express";
import { getBuild, listBuilds } from "../services/buildQueue";

const router = Router();

router.get("/", (req: Request, res: Response) => {
  const { projectId } = req.query;
  const builds = listBuilds(typeof projectId === "string" ? projectId : undefined);
  res.json({ builds });
});

router.get("/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const build = getBuild(id);

  if (!build) {
    res.status(404).json({ error: "Build not found" });
    return;
  }

  res.json({ build });
});

export default router;

