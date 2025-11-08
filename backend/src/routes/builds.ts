import type { Request, Response } from "express";
import { Router } from "express";
import { basename } from "path";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { getBuild, listBuilds } from "../services/buildQueue";

const router = Router();

router.get("/", (req: Request, res: Response) => {
  const { projectId } = req.query;
  const builds = listBuilds(typeof projectId === "string" ? projectId : undefined);
  res.json({ builds });
});

router.get("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const build = getBuild(id);

  if (!build) {
    res.status(404).json({ error: "Build not found" });
    return;
  }

  res.json({ build });
});

router.get("/:id/manifest", async (req: Request, res: Response) => {
  const { id } = req.params;
  const build = getBuild(id);
  if (!build?.manifestPath) {
    res.status(404).json({ error: "Manifest not found for this build" });
    return;
  }

  try {
    const manifestRaw = await readFile(build.manifestPath, "utf-8");
    res.json({ manifest: JSON.parse(manifestRaw) });
  } catch (error) {
    console.error("Failed to read manifest", error);
    res.status(500).json({ error: "Failed to read manifest" });
  }
});

router.get("/:id/artifact", (req: Request, res: Response) => {
  const { id } = req.params;
  const build = getBuild(id);
  if (!build?.artifactPath || !existsSync(build.artifactPath)) {
    res.status(404).json({ error: "Artifact not found for this build" });
    return;
  }

  const filename = basename(build.artifactPath);
  res.download(build.artifactPath, filename);
});

export default router;
