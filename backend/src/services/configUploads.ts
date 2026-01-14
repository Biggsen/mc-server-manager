import { createHash } from "crypto";
import { mkdir, readFile, readdir, rm, stat, unlink, writeFile } from "fs/promises";
import { dirname, join, posix, relative as pathRelative } from "path";
import type { StoredProject } from "../types/storage";
import { getProjectsRoot } from "../config";

const PROJECTS_ROOT = getProjectsRoot();
const UPLOAD_ROOT_SEGMENTS = ["config", "uploads"];

export function sanitizeRelativePath(input: string | undefined | null): string {
  if (typeof input !== "string") {
    throw new Error("relativePath is required");
  }
  let normalized = input.replace(/\\/g, "/").trim();
  if (normalized.startsWith("/")) {
    normalized = normalized.slice(1);
  }
  if (!normalized) {
    throw new Error("relativePath cannot be empty");
  }
  if (normalized.includes("..")) {
    throw new Error("relativePath cannot contain traversal segments");
  }
  return normalized;
}

export function getUploadsRoot(project: StoredProject): string {
  // Always use the actual project directory for uploads, never the template
  // Template root is read-only (especially in packaged Electron apps)
  const projectRoot = join(PROJECTS_ROOT, project.id);
  return join(projectRoot, ...UPLOAD_ROOT_SEGMENTS);
}

async function pruneEmptyDirectories(root: string, target: string): Promise<void> {
  let current = dirname(target);
  while (current.startsWith(root) && current !== root) {
    let entries: string[];
    try {
      entries = await readdir(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        current = dirname(current);
        continue;
      }
      throw error;
    }
    if (entries.length > 0) {
      break;
    }
    await rm(current, { recursive: false, force: true });
    current = dirname(current);
  }
}

export interface ConfigFileSummary {
  path: string;
  size: number;
  modifiedAt: string;
  sha256?: string;
  pluginId?: string;
  definitionId?: string;
}

export interface ConfigFileContent {
  path: string;
  content: string;
  sha256: string;
}

export async function saveUploadedConfigFile(
  project: StoredProject,
  relativePath: string,
  buffer: Buffer,
): Promise<ConfigFileContent> {
  const sanitized = sanitizeRelativePath(relativePath);
  const uploadsRoot = getUploadsRoot(project);
  const target = join(uploadsRoot, sanitized);
  
  // Ensure the uploads directory exists (creates project directory if needed)
  await mkdir(uploadsRoot, { recursive: true });
  await mkdir(dirname(target), { recursive: true });
  
  await writeFile(target, buffer);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  return {
    path: sanitized,
    content: buffer.toString("utf-8"),
    sha256,
  };
}

export async function overwriteUploadedConfigFile(
  project: StoredProject,
  relativePath: string,
  content: string,
): Promise<ConfigFileContent> {
  const sanitized = sanitizeRelativePath(relativePath);
  const buffer = Buffer.from(content, "utf-8");
  const uploadsRoot = getUploadsRoot(project);
  const target = join(uploadsRoot, sanitized);
  
  // Ensure the uploads directory exists (creates project directory if needed)
  await mkdir(uploadsRoot, { recursive: true });
  await mkdir(dirname(target), { recursive: true });
  
  await writeFile(target, buffer);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  return {
    path: sanitized,
    content,
    sha256,
  };
}

export async function readUploadedConfigFile(
  project: StoredProject,
  relativePath: string,
): Promise<ConfigFileContent> {
  const sanitized = sanitizeRelativePath(relativePath);
  const target = join(getUploadsRoot(project), sanitized);
  const buffer = await readFile(target, "utf-8");
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  return {
    path: sanitized,
    content: buffer,
    sha256,
  };
}

export async function deleteUploadedConfigFile(
  project: StoredProject,
  relativePath: string,
): Promise<void> {
  const sanitized = sanitizeRelativePath(relativePath);
  const target = join(getUploadsRoot(project), sanitized);
  
  // Check if target exists and is a file before attempting to delete
  try {
    const stats = await stat(target);
    if (!stats.isFile()) {
      // If it's a directory, don't try to unlink it - just prune empty directories
      await pruneEmptyDirectories(getUploadsRoot(project), target).catch((error) => {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && code !== "ENOTEMPTY" && code !== "EPERM") {
          throw error;
        }
      });
      return;
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // File doesn't exist - that's fine, just return
      return;
    }
    // Other errors should be re-thrown
    throw error;
  }
  
  // Target exists and is a file - delete it
  await unlink(target);
  await pruneEmptyDirectories(getUploadsRoot(project), target).catch((error) => {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTEMPTY" && code !== "EPERM") {
      throw error;
    }
  });
}

export async function listUploadedConfigFiles(project: StoredProject): Promise<ConfigFileSummary[]> {
  const root = getUploadsRoot(project);
  const summaries: ConfigFileSummary[] = [];
  const metadataMap = new Map<string, { pluginId?: string; definitionId?: string; sha256?: string }>();
  for (const entry of project.configs ?? []) {
    metadataMap.set(entry.path, {
      pluginId: entry.pluginId,
      definitionId: entry.definitionId,
      sha256: entry.sha256,
    });
  }

  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return;
      }
      throw error;
    }

    await Promise.all(
      entries.map(async (entry) => {
        const entryName = entry.name.toString();
        const entryPath = join(current, entryName);
        if (entry.isDirectory()) {
          await walk(entryPath);
          return;
        }
        if (!entry.isFile()) {
          return;
        }
        const details = await stat(entryPath);
        const relative = posix.normalize(pathRelative(root, entryPath).replace(/\\/g, "/"));
        const metadata = metadataMap.get(relative);
        summaries.push({
          path: relative,
          size: details.size,
          modifiedAt: details.mtime.toISOString(),
          sha256: metadata?.sha256,
          pluginId: metadata?.pluginId,
          definitionId: metadata?.definitionId,
        });
      }),
    );
  }

  await walk(root);
  summaries.sort((a, b) => a.path.localeCompare(b.path));
  return summaries;
}

export async function collectUploadedConfigMaterials(
  project: StoredProject,
): Promise<ConfigFileContent[]> {
  const uploadsRoot = getUploadsRoot(project);
  const results: ConfigFileContent[] = [];
  for (const entry of project.configs ?? []) {
    const sanitized = sanitizeRelativePath(entry.path);
    const target = join(uploadsRoot, sanitized);
    try {
      const buffer = await readFile(target, "utf-8");
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      results.push({
        path: sanitized,
        content: buffer,
        sha256,
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        console.warn(`Failed to read uploaded config ${sanitized} for project ${project.id}`, error);
      }
    }
  }
  return results;
}


