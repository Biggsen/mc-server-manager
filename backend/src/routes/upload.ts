import type { Request, Response } from "express";
import { Router } from "express";
import { readdir, stat, mkdir, rm } from "fs/promises";
import { join, dirname } from "path";
import { findProject } from "../storage/projectsStore";
import { listRemote, uploadFile, deleteRemoteFile, downloadRemoteFile, readRemoteGeneratorVersion } from "../services/sftpClient";
import { getRunsRoot, liveServers, type LiveServerConfig } from "../config";
import { readGeneratorVersionFromFile } from "../services/configUploads";
import { normalizeSshHost } from "../services/sshConnection";
import type { StoredProject } from "../types/storage";

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

function projectMatchesLiveServer(project: StoredProject, cfg: LiveServerConfig): boolean {
  const sftp = project.sftp;
  if (!sftp) return false;
  const projectHost = normalizeSshHost(sftp.host).toLowerCase();
  const serverHost = normalizeSshHost(cfg.ssh.host).toLowerCase();
  if (!projectHost || !serverHost || projectHost !== serverHost) return false;
  const projectUser = (sftp.username ?? "").trim().toLowerCase();
  const serverUser = (cfg.ssh.user ?? "").trim().toLowerCase();
  if (!projectUser || !serverUser || projectUser !== serverUser) return false;
  const projectPort = sftp.port ?? 22;
  return projectPort === cfg.ssh.port;
}

function findMatchingLiveServer(project: StoredProject): LiveServerConfig | undefined {
  for (const cfg of liveServers) {
    if (projectMatchesLiveServer(project, cfg)) {
      return cfg;
    }
  }
  return undefined;
}

function resolveUploadPassword(project: StoredProject, providedRaw: unknown): string | null {
  const provided =
    typeof providedRaw === "string"
      ? providedRaw.trim()
      : "";
  if (provided.length > 0) {
    return provided;
  }
  const cfg = findMatchingLiveServer(project);
  if (!cfg) {
    return null;
  }
  const fallback = (cfg.files.password || cfg.ssh.password || "").trim();
  return fallback.length > 0 ? fallback : null;
}

router.get("/default-password-available", async (req: Request, res: Response) => {
  try {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : "";
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }
    const project = await findProject(projectId);
    const cfg = project ? findMatchingLiveServer(project) : undefined;
    if (!project?.sftp || !cfg) {
      res.json({ available: false });
      return;
    }
    const hasDefault = (cfg.files.password || cfg.ssh.password || "").trim().length > 0;
    res.json({ available: hasDefault });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Upload default-password-available error", error);
    res.status(500).json({ error: message });
  }
});

router.post("/list-remote", async (req: Request, res: Response) => {
  try {
    const { projectId, password, path: pathParam } = req.body ?? {};
    if (!projectId || typeof projectId !== "string") {
      res.status(400).json({ error: "projectId is required" });
      return;
    }
    const project = await findProject(projectId);
    if (!project?.sftp) {
      res.status(400).json({ error: "Project has no SFTP config; set it in Project Settings" });
      return;
    }
    const resolvedPassword = resolveUploadPassword(project, password);
    if (!resolvedPassword) {
      res.status(400).json({ error: "SFTP password is required" });
      return;
    }
    const path = typeof pathParam === "string" && pathParam.trim()
      ? pathParam.trim()
      : project.sftp.remotePath;
    const entries = await listRemote(project.sftp, resolvedPassword, path);
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

router.get("/file-version-local", async (req: Request, res: Response) => {
  try {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : "";
    const pathParam = typeof req.query.path === "string" ? req.query.path : "";
    if (!projectId || !pathParam) {
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
      res.status(400).json({ error: "Only files can be inspected" });
      return;
    }
    const generatorVersion = await readGeneratorVersionFromFile(fullPath, relPath);
    res.json({ path: relPath, generatorVersion: generatorVersion ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Upload file-version-local error", error);
    res.status(500).json({ error: message });
  }
});

router.post("/file-version-remote", async (req: Request, res: Response) => {
  try {
    const { projectId, password, path: pathParam } = req.body ?? {};
    if (
      !projectId ||
      typeof projectId !== "string" ||
      !pathParam ||
      typeof pathParam !== "string"
    ) {
      res.status(400).json({ error: "projectId and path are required" });
      return;
    }
    const project = await findProject(projectId);
    if (!project?.sftp) {
      res.status(400).json({ error: "Project has no SFTP config; set it in Project Settings" });
      return;
    }
    const resolvedPassword = resolveUploadPassword(project, password);
    if (!resolvedPassword) {
      res.status(400).json({ error: "SFTP password is required" });
      return;
    }
    const path = pathParam.trim().replace(/\\/g, "/");
    const generatorVersion = await readRemoteGeneratorVersion(project.sftp, resolvedPassword, path);
    res.json({ path, generatorVersion: generatorVersion ?? null });
  } catch (error) {
    const detail = formatSftpError(error);
    const projectIdForContext = req.body?.projectId;
    const projectForContext =
      typeof projectIdForContext === "string" ? await findProject(projectIdForContext) : undefined;
    const context =
      projectForContext?.sftp
        ? ` (${projectForContext.sftp.host}:${projectForContext.sftp.port ?? 22})`
        : "";
    console.error("Upload file-version-remote error", error);
    res.status(500).json({ error: detail + context });
  }
});

router.post("/upload", async (req: Request, res: Response) => {
  try {
    const { projectId, password, localPath, remotePath } = req.body ?? {};
    if (
      !projectId ||
      typeof projectId !== "string" ||
      !localPath ||
      typeof localPath !== "string" ||
      !remotePath ||
      typeof remotePath !== "string"
    ) {
      res.status(400).json({ error: "projectId, localPath, and remotePath are required" });
      return;
    }
    const project = await findProject(projectId);
    if (!project?.sftp) {
      res.status(400).json({ error: "Project has no SFTP config" });
      return;
    }
    const resolvedPassword = resolveUploadPassword(project, password);
    if (!resolvedPassword) {
      res.status(400).json({ error: "SFTP password is required" });
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
    await uploadFile(project.sftp, resolvedPassword, fullLocalPath, remoteForSftp);
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
      !remotePath ||
      typeof remotePath !== "string"
    ) {
      res.status(400).json({ error: "projectId and remotePath are required" });
      return;
    }
    const project = await findProject(projectId);
    if (!project?.sftp) {
      res.status(400).json({ error: "Project has no SFTP config" });
      return;
    }
    const resolvedPassword = resolveUploadPassword(project, password);
    if (!resolvedPassword) {
      res.status(400).json({ error: "SFTP password is required" });
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
    await downloadRemoteFile(project.sftp, resolvedPassword, remotePath.trim().replace(/\\/g, "/"), fullLocalPath);
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
      !pathParam ||
      typeof pathParam !== "string"
    ) {
      res.status(400).json({ error: "projectId and path are required" });
      return;
    }
    const project = await findProject(projectId);
    if (!project?.sftp) {
      res.status(400).json({ error: "Project has no SFTP config" });
      return;
    }
    const resolvedPassword = resolveUploadPassword(project, password);
    if (!resolvedPassword) {
      res.status(400).json({ error: "SFTP password is required" });
      return;
    }
    const path = pathParam.trim().replace(/\\/g, "/");
    await deleteRemoteFile(project.sftp, resolvedPassword, path);
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
    await rm(fullPath, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Upload delete-local error", error);
    res.status(500).json({ error: message });
  }
});

export default router;
