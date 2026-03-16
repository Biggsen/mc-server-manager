import type { Request, Response } from "express";
import { Router } from "express";
import { readdir, stat, unlink, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { findProject } from "../storage/projectsStore";
import { listRemote, uploadFile, deleteRemoteFile, downloadRemoteFile } from "../services/sftpClient";
import { getRunsRoot } from "../config";

const router = Router();
const WORKSPACE_ROOT = join(getRunsRoot(), "workspaces");

function getProjectWorkspacePath(projectId: string): string {
  const safe = projectId.replace(/[^a-zA-Z0-9-_]/g, "-");
  return join(WORKSPACE_ROOT, safe);
}

function sanitizeRelativePath(raw: string): string {
  const normalized = raw.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (normalized.includes("..")) return "";
  return normalized;
}

function formatSftpError(error: unknown): string {
  if (error instanceof Error) {
    const parts = [error.message];
    const err = error as Error & { description?: string; level?: string; code?: string };
    if (err.description && err.description !== error.message) parts.push(err.description);
    if (err.level) parts.push(`(level: ${err.level})`);
    if (err.code) parts.push(`(code: ${err.code})`);
    return parts.join(" ");
  }
  return String(error);
}

router.post("/list-remote", async (req: Request, res: Response) => {
  try {
    const { projectId, password, path: pathParam } = req.body ?? {};
    if (!projectId || typeof projectId !== "string" || !password || typeof password !== "string") {
      res.status(400).json({ error: "projectId and password are required" });
      return;
    }
    const project = await findProject(projectId);
    if (!project?.sftp) {
      res.status(400).json({ error: "Project has no SFTP config; set it in Project Settings" });
      return;
    }
    const path = typeof pathParam === "string" && pathParam.trim()
      ? pathParam.trim()
      : project.sftp.remotePath;
    const entries = await listRemote(project.sftp, password, path);
    res.json({ entries });
  } catch (error) {
    const detail = formatSftpError(error);
    const projectIdForContext = req.body?.projectId;
    const projectForContext =
      typeof projectIdForContext === "string" ? await findProject(projectIdForContext) : undefined;
    const context =
      projectForContext?.sftp
        ? ` (${projectForContext.sftp.host}:${projectForContext.sftp.port ?? 22})`
        : "";
    const message = detail + context;
    console.error("Upload list-remote error", error);
    res.status(500).json({ error: message });
  }
});

router.get("/list-local", async (req: Request, res: Response) => {
  try {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : "";
    const pathParam = typeof req.query.path === "string" ? req.query.path : "";
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }
    const project = await findProject(projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const workspaceDir = getProjectWorkspacePath(projectId);
    const relPath = sanitizeRelativePath(pathParam);
    const targetDir = relPath ? join(workspaceDir, relPath) : workspaceDir;
    if (!targetDir.startsWith(workspaceDir)) {
      res.status(400).json({ error: "Invalid path" });
      return;
    }
    const names = await readdir(targetDir, { withFileTypes: true });
    const entries = await Promise.all(
      names.map(async (d) => {
        const fullPath = join(targetDir, d.name);
        const s = await stat(fullPath);
        const rel = relPath ? `${relPath}/${d.name}` : d.name;
        const mtime = s.mtime ? s.mtime.toISOString() : undefined;
        return {
          name: d.name,
          path: rel.replace(/\\/g, "/"),
          type: s.isDirectory() ? "directory" as const : "file" as const,
          size: s.isFile() ? s.size : undefined,
          mtime,
        };
      }),
    );
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    res.json({ entries });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Upload list-local error", error);
    res.status(500).json({ error: message });
  }
});

router.post("/upload", async (req: Request, res: Response) => {
  try {
    const { projectId, password, localPath, remotePath } = req.body ?? {};
    if (
      !projectId ||
      typeof projectId !== "string" ||
      !password ||
      typeof password !== "string" ||
      !localPath ||
      typeof localPath !== "string" ||
      !remotePath ||
      typeof remotePath !== "string"
    ) {
      res.status(400).json({ error: "projectId, password, localPath, and remotePath are required" });
      return;
    }
    const project = await findProject(projectId);
    if (!project?.sftp) {
      res.status(400).json({ error: "Project has no SFTP config" });
      return;
    }
    const sanitizedLocal = sanitizeRelativePath(localPath);
    if (!sanitizedLocal) {
      res.status(400).json({ error: "Invalid localPath" });
      return;
    }
    const workspaceDir = getProjectWorkspacePath(projectId);
    const fullLocalPath = join(workspaceDir, sanitizedLocal);
    if (!fullLocalPath.startsWith(workspaceDir)) {
      res.status(400).json({ error: "Invalid localPath" });
      return;
    }
    const fullRemotePath = remotePath.replace(/\\/g, "/").trim() || project.sftp.remotePath;
    const root = (project.sftp.remotePath ?? "").replace(/\/+$/, "").trim();
    const remoteForSftp =
      root && (fullRemotePath === root || fullRemotePath.startsWith(root + "/"))
        ? fullRemotePath.slice(root.length).replace(/^\/+/, "") || "."
        : fullRemotePath;
    await uploadFile(project.sftp, password, fullLocalPath, remoteForSftp);
    res.json({ ok: true });
  } catch (error) {
    const detail = formatSftpError(error);
    const projectIdForContext = req.body?.projectId;
    const projectForContext =
      typeof projectIdForContext === "string" ? await findProject(projectIdForContext) : undefined;
    const context =
      projectForContext?.sftp
        ? ` (${projectForContext.sftp.host}:${projectForContext.sftp.port ?? 22})`
        : "";
    const message = detail + context;
    console.error("Upload error", error);
    res.status(500).json({ error: message });
  }
});

router.post("/download", async (req: Request, res: Response) => {
  try {
    const { projectId, password, remotePath, localPath: localPathParam } = req.body ?? {};
    if (
      !projectId ||
      typeof projectId !== "string" ||
      !password ||
      typeof password !== "string" ||
      !remotePath ||
      typeof remotePath !== "string"
    ) {
      res.status(400).json({ error: "projectId, password, and remotePath are required" });
      return;
    }
    const project = await findProject(projectId);
    if (!project?.sftp) {
      res.status(400).json({ error: "Project has no SFTP config" });
      return;
    }
    const name = remotePath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "download";
    const relPath = sanitizeRelativePath(
      typeof localPathParam === "string" && localPathParam.trim()
        ? localPathParam.trim()
        : name,
    );
    if (!relPath) {
      res.status(400).json({ error: "Invalid localPath" });
      return;
    }
    const workspaceDir = getProjectWorkspacePath(projectId);
    const fullLocalPath = join(workspaceDir, relPath);
    if (!fullLocalPath.startsWith(workspaceDir)) {
      res.status(400).json({ error: "Invalid localPath" });
      return;
    }
    await mkdir(dirname(fullLocalPath), { recursive: true });
    await downloadRemoteFile(project.sftp, password, remotePath.trim().replace(/\\/g, "/"), fullLocalPath);
    res.json({ ok: true });
  } catch (error) {
    const detail = formatSftpError(error);
    const projectIdForContext = req.body?.projectId;
    const projectForContext =
      typeof projectIdForContext === "string" ? await findProject(projectIdForContext) : undefined;
    const context =
      projectForContext?.sftp
        ? ` (${projectForContext.sftp.host}:${projectForContext.sftp.port ?? 22})`
        : "";
    console.error("Upload download error", error);
    res.status(500).json({ error: detail + context });
  }
});

router.post("/delete-remote", async (req: Request, res: Response) => {
  try {
    const { projectId, password, path: pathParam } = req.body ?? {};
    if (
      !projectId ||
      typeof projectId !== "string" ||
      !password ||
      typeof password !== "string" ||
      !pathParam ||
      typeof pathParam !== "string"
    ) {
      res.status(400).json({ error: "projectId, password, and path are required" });
      return;
    }
    const project = await findProject(projectId);
    if (!project?.sftp) {
      res.status(400).json({ error: "Project has no SFTP config" });
      return;
    }
    const path = pathParam.trim().replace(/\\/g, "/");
    await deleteRemoteFile(project.sftp, password, path);
    res.json({ ok: true });
  } catch (error) {
    const detail = formatSftpError(error);
    const projectIdForContext = req.body?.projectId;
    const projectForContext =
      typeof projectIdForContext === "string" ? await findProject(projectIdForContext) : undefined;
    const context =
      projectForContext?.sftp
        ? ` (${projectForContext.sftp.host}:${projectForContext.sftp.port ?? 22})`
        : "";
    res.status(500).json({ error: detail + context });
  }
});

router.post("/delete-local", async (req: Request, res: Response) => {
  try {
    const { projectId, path: pathParam } = req.body ?? {};
    if (!projectId || typeof projectId !== "string" || !pathParam || typeof pathParam !== "string") {
      res.status(400).json({ error: "projectId and path are required" });
      return;
    }
    const project = await findProject(projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const relPath = sanitizeRelativePath(pathParam);
    if (!relPath) {
      res.status(400).json({ error: "Invalid path" });
      return;
    }
    const workspaceDir = getProjectWorkspacePath(projectId);
    const fullPath = join(workspaceDir, relPath);
    if (!fullPath.startsWith(workspaceDir)) {
      res.status(400).json({ error: "Invalid path" });
      return;
    }
    const entry = await stat(fullPath);
    if (!entry.isFile()) {
      res.status(400).json({ error: "Only files can be deleted; not directories" });
      return;
    }
    await unlink(fullPath);
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Upload delete-local error", error);
    res.status(500).json({ error: message });
  }
});

export default router;
