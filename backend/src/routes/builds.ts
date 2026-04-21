import type { Request, Response } from "express";
import { Router } from "express";
import { basename } from "path";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import AdmZip from "adm-zip";
import { getBuild, listBuilds } from "../services/buildQueue";

const router = Router();

interface ManifestConfigEntry {
  path: string;
  sha256: string | undefined;
}

const MAX_TEXT_DIFF_BYTES = 512 * 1024;

function normalizeManifestConfigs(raw: unknown): ManifestConfigEntry[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const maybeConfigs = (raw as Record<string, unknown>).configs;
  if (!Array.isArray(maybeConfigs)) return [];
  return maybeConfigs
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const path = String((entry as Record<string, unknown>).path ?? "").trim();
      if (!path) return null;
      const shaRaw = (entry as Record<string, unknown>).sha256;
      return { path, sha256: typeof shaRaw === "string" ? shaRaw : undefined };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

function isLikelyBinary(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, 4096);
  for (let i = 0; i < limit; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

function readZipEntryAsText(zipPath: string, entryPath: string): { content: string | null; missing: boolean; binary: boolean } {
  if (!existsSync(zipPath)) {
    return { content: null, missing: true, binary: false };
  }
  const zip = new AdmZip(zipPath);
  const entry = zip.getEntry(entryPath);
  if (!entry) {
    return { content: null, missing: true, binary: false };
  }
  const data = entry.getData();
  if (isLikelyBinary(data)) {
    return { content: null, missing: false, binary: true };
  }
  if (data.length > MAX_TEXT_DIFF_BYTES) {
    return { content: null, missing: false, binary: false };
  }
  return { content: data.toString("utf-8"), missing: false, binary: false };
}

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

router.get("/:olderId/config-diff/:newerId", async (req: Request, res: Response) => {
  const { olderId, newerId } = req.params;
  const path = typeof req.query.path === "string" ? req.query.path.trim() : "";
  if (!path) {
    res.status(400).json({ error: "Query parameter 'path' is required" });
    return;
  }

  const olderBuild = getBuild(olderId);
  const newerBuild = getBuild(newerId);
  if (!olderBuild || !newerBuild) {
    res.status(404).json({ error: "Build not found" });
    return;
  }
  if (!olderBuild.manifestPath || !newerBuild.manifestPath) {
    res.status(404).json({ error: "Manifest not found for one or both builds" });
    return;
  }
  if (!olderBuild.artifactPath || !newerBuild.artifactPath) {
    res.status(404).json({ error: "Artifact not found for one or both builds" });
    return;
  }

  try {
    const [olderManifestRaw, newerManifestRaw] = await Promise.all([
      readFile(olderBuild.manifestPath, "utf-8"),
      readFile(newerBuild.manifestPath, "utf-8"),
    ]);
    const olderManifest = JSON.parse(olderManifestRaw);
    const newerManifest = JSON.parse(newerManifestRaw);

    const olderConfig = normalizeManifestConfigs(olderManifest).find((entry) => entry.path === path);
    const newerConfig = normalizeManifestConfigs(newerManifest).find((entry) => entry.path === path);
    if (!olderConfig && !newerConfig) {
      res.status(404).json({ error: "Config path not found in either build manifest" });
      return;
    }

    const oldFile = readZipEntryAsText(olderBuild.artifactPath, path);
    const newFile = readZipEntryAsText(newerBuild.artifactPath, path);
    const oldTooLarge = !oldFile.missing && !oldFile.binary && oldFile.content === null;
    const newTooLarge = !newFile.missing && !newFile.binary && newFile.content === null;

    res.json({
      diff: {
        path,
        oldSha: olderConfig?.sha256 ?? "",
        newSha: newerConfig?.sha256 ?? "",
        oldContent: oldFile.content,
        newContent: newFile.content,
        oldMissing: oldFile.missing,
        newMissing: newFile.missing,
        oldBinary: oldFile.binary,
        newBinary: newFile.binary,
        oldTooLarge,
        newTooLarge,
        maxDiffBytes: MAX_TEXT_DIFF_BYTES,
      },
    });
  } catch (error) {
    console.error("Failed to load build config diff", error);
    res.status(500).json({ error: "Failed to load build config diff" });
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
