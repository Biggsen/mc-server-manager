import { createHash } from "crypto";
import { readdir, readFile, writeFile, stat, mkdir, unlink } from "fs/promises";
import { join } from "path";
import { getRunsRoot } from "../config";
import {
  saveUploadedConfigFile,
  isBinaryFile,
  sanitizeRelativePath,
} from "./configUploads";
import type { StoredProject } from "../types/storage";
import { findProject } from "../storage/projectsStore";
import { setProjectAssets } from "../storage/projectsStore";

const WORKSPACE_ROOT = join(getRunsRoot(), "workspaces");

function getProjectWorkspacePath(projectId: string): string {
  const safeProject = projectId.replace(/[^a-zA-Z0-9-_]/g, "-");
  return join(WORKSPACE_ROOT, safeProject);
}

function getPluginsDir(projectId: string): string {
  return join(getProjectWorkspacePath(projectId), "plugins");
}

const PLUGINS_PREFIX = "plugins/";

function ensurePathUnderPlugins(path: string): string {
  const sanitized = sanitizeRelativePath(path);
  if (!sanitized.startsWith(PLUGINS_PREFIX) && sanitized !== "plugins") {
    throw new Error(`Path must be under plugins/: ${path}`);
  }
  return sanitized;
}

export interface WorkspaceFileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  modifiedAt?: string;
  editable?: boolean;
}

export async function listPluginFiles(
  projectId: string,
  subPath: string = ""
): Promise<WorkspaceFileEntry[]> {
  const pluginsDir = getPluginsDir(projectId);
  const targetDir =
    subPath && subPath !== "plugins"
      ? join(pluginsDir, ensurePathUnderPlugins(subPath).replace(/^plugins\/?/, ""))
      : pluginsDir;

  try {
    const entries = await readdir(targetDir, { withFileTypes: true });
    const results: WorkspaceFileEntry[] = [];

    for (const entry of entries) {
      const relPath = subPath
        ? `${subPath.replace(/\/$/, "")}/${entry.name}`
        : `plugins/${entry.name}`;
      const entryPath = join(targetDir, entry.name);

      if (entry.isDirectory()) {
        results.push({
          name: entry.name,
          path: relPath,
          type: "directory",
        });
      } else if (entry.isFile()) {
        try {
          const details = await stat(entryPath);
          const editable = !entry.name.toLowerCase().endsWith(".jar");
          results.push({
            name: entry.name,
            path: relPath,
            type: "file",
            size: details.size,
            modifiedAt: details.mtime.toISOString(),
            editable,
          });
        } catch {
          results.push({
            name: entry.name,
            path: relPath,
            type: "file",
            editable: !entry.name.toLowerCase().endsWith(".jar"),
          });
        }
      }
    }

    return results.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function readPluginFile(
  projectId: string,
  path: string
): Promise<{ content: string; isBinary: boolean }> {
  const sanitized = ensurePathUnderPlugins(path);
  const fullPath = join(getProjectWorkspacePath(projectId), sanitized);

  const buffer = await readFile(fullPath);
  const isBinary = isBinaryFile(sanitized);

  return {
    content: isBinary ? buffer.toString("base64") : buffer.toString("utf-8"),
    isBinary,
  };
}

export async function deletePluginFile(projectId: string, path: string): Promise<void> {
  const sanitized = ensurePathUnderPlugins(path);
  const fullPath = join(getProjectWorkspacePath(projectId), sanitized);
  const entry = await stat(fullPath);
  if (!entry.isFile()) {
    throw new Error("Not a file");
  }
  await unlink(fullPath);
}

export async function writePluginFile(
  projectId: string,
  path: string,
  content: string,
  isBinary: boolean
): Promise<void> {
  const sanitized = ensurePathUnderPlugins(path);
  const fullPath = join(getProjectWorkspacePath(projectId), sanitized);

  await mkdir(join(fullPath, ".."), { recursive: true });

  const buffer = isBinary ? Buffer.from(content, "base64") : Buffer.from(content, "utf-8");
  await writeFile(fullPath, buffer);
}

export async function promotePluginFiles(
  projectId: string,
  paths: string[]
): Promise<{ promoted: string[]; errors: { path: string; error: string }[] }> {
  const project = await findProject(projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  const promoted: string[] = [];
  const errors: { path: string; error: string }[] = [];
  const workspaceDir = getProjectWorkspacePath(projectId);
  const newEntries: { path: string; sha256: string; pluginId?: string }[] = [];

  function inferPluginIdFromPath(proj: StoredProject, path: string): string | undefined {
    const match = path.match(/^plugins\/([^/]+)/);
    if (!match) return undefined;
    const folderName = match[1];
    const plugin = (proj.plugins ?? []).find(
      (p) => p.id && p.id.toLowerCase() === folderName.toLowerCase(),
    );
    return plugin?.id;
  }

  for (const path of paths) {
    try {
      const sanitized = ensurePathUnderPlugins(path);
      const fullPath = join(workspaceDir, sanitized);
      const buffer = await readFile(fullPath);
      const entry = await stat(fullPath);
      if (!entry.isFile()) {
        errors.push({ path: sanitized, error: "Not a file" });
        continue;
      }

      await saveUploadedConfigFile(project, sanitized, buffer);

      const sha256 = createHash("sha256").update(buffer).digest("hex");
      const pluginId = inferPluginIdFromPath(project, sanitized);
      newEntries.push({ path: sanitized, sha256, pluginId });
      promoted.push(sanitized);
    } catch (error) {
      errors.push({
        path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (newEntries.length > 0) {
    const currentConfigs = project.configs ?? [];
    const pathSet = new Set(newEntries.map((e) => e.path));
    const nextConfigs = [
      ...currentConfigs.filter((e) => !pathSet.has(e.path)),
      ...newEntries.map(({ path, sha256, pluginId }) => ({ path, sha256, pluginId })),
    ];
    nextConfigs.sort((a, b) => a.path.localeCompare(b.path));
    await setProjectAssets(projectId, { configs: nextConfigs });
  }

  return { promoted, errors };
}
