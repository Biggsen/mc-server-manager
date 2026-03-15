import type { Request, Response } from "express";
import { Router } from "express";
import { existsSync } from "fs";
import {
  createDeploymentTarget,
  findDeploymentTarget,
  listDeploymentTargets,
} from "../services/deploymentStore";
import {
  appendDeploymentRecord,
  deleteDeploymentRecord,
  findDeploymentRecord,
  getNextDeploymentId,
  getShortDeploymentId,
  listDeploymentRecords,
} from "../services/deploymentRecordStore";
import { createDeploymentZip } from "../services/deploymentZipService";
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

router.get("/records", async (req: Request, res: Response) => {
  try {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    const records = await listDeploymentRecords(projectId);
    res.json({ deployments: records });
  } catch (error) {
    console.error("Failed to list deployment records", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to list deployments" });
  }
});

router.post("/records", async (req: Request, res: Response) => {
  try {
    const {
      projectId,
      buildId,
      description,
      includeServerJar,
      includeWorlds,
      serverJarPath,
    } = req.body ?? {};
    if (!projectId || !buildId) {
      res.status(400).json({ error: "projectId and buildId are required." });
      return;
    }
    const build = getBuild(buildId);
    if (!build) {
      res.status(404).json({ error: "Build not found." });
      return;
    }
    if (build.status !== "succeeded") {
      res.status(400).json({ error: "Build has not succeeded; only succeeded builds can be deployed." });
      return;
    }
    if (!build.artifactPath || !existsSync(build.artifactPath)) {
      res.status(404).json({ error: "Build artifact not found." });
      return;
    }
    if (build.projectId !== projectId) {
      res.status(400).json({ error: "Build does not belong to the given project." });
      return;
    }
    const shortId = await getNextDeploymentId(projectId);
    const deploymentId = `${projectId}:${shortId}`;
    const zipOptions =
      includeServerJar || includeWorlds
        ? {
            includeServerJar: Boolean(includeServerJar),
            includeWorlds: Boolean(includeWorlds),
            serverJarPath:
              typeof serverJarPath === "string" && serverJarPath.trim()
                ? serverJarPath.trim()
                : undefined,
          }
        : undefined;
    const { artifactPath, artifactSize, artifactSha256 } = await createDeploymentZip(
      build.artifactPath,
      projectId,
      shortId,
      zipOptions,
    );
    const createdAt = new Date().toISOString();
    const record = await appendDeploymentRecord(
      {
        projectId,
        buildId,
        createdAt,
        description: description ? String(description).trim() || undefined : undefined,
        artifactPath,
        artifactSize,
        artifactSha256,
      },
      deploymentId,
    );
    res.status(201).json({ deployment: record });
  } catch (error) {
    console.error("Failed to create deployment", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create deployment" });
  }
});

router.get("/records/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const record = await findDeploymentRecord(id);
    if (!record) {
      res.status(404).json({ error: "Deployment not found." });
      return;
    }
    res.json({ deployment: record });
  } catch (error) {
    console.error("Failed to get deployment record", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to get deployment" });
  }
});

router.delete("/records/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const removed = await deleteDeploymentRecord(id);
    if (!removed) {
      res.status(404).json({ error: "Deployment not found." });
      return;
    }
    res.status(204).send();
  } catch (error) {
    console.error("Failed to delete deployment", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to delete deployment" });
  }
});

router.get("/records/:id/artifact", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const record = await findDeploymentRecord(id);
    if (!record) {
      res.status(404).json({ error: "Deployment not found." });
      return;
    }
    if (!existsSync(record.artifactPath)) {
      res.status(404).json({ error: "Deployment artifact not found on disk." });
      return;
    }
    const shortId = getShortDeploymentId(record.id);
    const filename = `${record.projectId}-${shortId}.zip`;
    res.download(record.artifactPath, filename);
  } catch (error) {
    console.error("Failed to download deployment artifact", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to download" });
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


