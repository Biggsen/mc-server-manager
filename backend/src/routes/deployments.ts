import type { Request, Response } from "express";
import { Router } from "express";
import {
  createDeploymentTarget,
  findDeploymentTarget,
  listDeploymentTargets,
} from "../services/deploymentStore";
import { getBuild } from "../services/buildQueue";
import { publishBuildToTarget } from "../services/deploymentManager";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  const targets = await listDeploymentTargets();
  res.json({ targets });
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const { name, type, notes, folder, sftp } = req.body ?? {};
    if (!name || !type) {
      res.status(400).json({ error: "Deployment target name and type are required." });
      return;
    }
    const target = await createDeploymentTarget({
      name,
      type,
      notes,
      folder,
      sftp,
    });
    res.status(201).json({ target });
  } catch (error) {
    console.error("Failed to create deployment target", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create deployment target" });
  }
});

router.post("/:id/publish", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { buildId } = req.body ?? {};

    if (!buildId) {
      res.status(400).json({ error: "buildId is required" });
      return;
    }

    const target = await findDeploymentTarget(id);
    if (!target) {
      res.status(404).json({ error: "Deployment target not found" });
      return;
    }

    const build = getBuild(buildId);
    if (!build) {
      res.status(404).json({ error: "Build not found" });
      return;
    }

    if (!build.artifactPath) {
      res.status(400).json({ error: "Build does not have an artifact to deploy" });
      return;
    }

    const deployment = await publishBuildToTarget(target, build);
    res.status(202).json({ deployment });
  } catch (error) {
    console.error("Deployment publish failed", error);
    res.status(500).json({ error: "Failed to queue deployment" });
  }
});

export default router;


