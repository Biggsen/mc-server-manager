import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import AdmZip from "adm-zip";
import { getDeploymentsRoot } from "../config";

export interface CreateDeploymentZipOptions {
  includeWorlds?: boolean;
  includeServerJar?: boolean;
  serverJarPath?: string;
}

const SERVER_AUTO_GENERATED = new Set([
  "eula.txt",
  "usercache.json",
  "ops.json",
  "whitelist.json",
  "banned-ips.json",
  "banned-players.json",
]);

function normalizeEntryPath(entryName: string): string | undefined {
  let normalized = entryName.replace(/\\/g, "/");
  normalized = normalized.replace(/^\/+/, "");
  if (!normalized || normalized === ".") {
    return undefined;
  }
  if (normalized.includes("../")) {
    return undefined;
  }
  if (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function shouldIncludeInDeployment(
  relativePath: string,
  options?: CreateDeploymentZipOptions,
): boolean {
  if (relativePath.startsWith("profiles/") || relativePath === "profiles") {
    return false;
  }
  if (relativePath.startsWith("overlays/") || relativePath === "overlays") {
    return false;
  }
  if (relativePath === "plugins/registry.yml") {
    return false;
  }
  if (relativePath.startsWith("config/") || relativePath === "config") {
    return true;
  }
  if (relativePath.startsWith("plugins/") || relativePath === "plugins") {
    return true;
  }
  if (options?.includeWorlds) {
    const worldRoot = relativePath.split("/")[0];
    if (
      worldRoot === "world" ||
      worldRoot === "world_nether" ||
      worldRoot === "world_the_end"
    ) {
      return true;
    }
  }
  const rootName = relativePath.split("/")[0];
  if (rootName === relativePath) {
    return !SERVER_AUTO_GENERATED.has(relativePath);
  }
  return false;
}

export interface CreateDeploymentZipResult {
  artifactPath: string;
  artifactSize: number;
  artifactSha256: string;
}

/**
 * Create a deployment zip from a build artifact: filter to server-runtime paths only
 * and optionally wrap in a top-level folder <projectId>-<deploymentId>/.
 */
export async function createDeploymentZip(
  buildArtifactPath: string,
  projectId: string,
  deploymentId: string,
  options?: CreateDeploymentZipOptions,
): Promise<CreateDeploymentZipResult> {
  const sourceZip = new AdmZip(buildArtifactPath);
  const entries = sourceZip.getEntries();
  const prefix = `${projectId}-${deploymentId}/`;
  const outZip = new AdmZip();

  for (const entry of entries) {
    const relativePath = normalizeEntryPath(entry.entryName);
    if (!relativePath) {
      continue;
    }
    if (!shouldIncludeInDeployment(relativePath, options)) {
      continue;
    }
    const entryPath = entry.isDirectory ? relativePath + "/" : relativePath;
    const targetPath = prefix + entryPath;
    if (entry.isDirectory) {
      outZip.addFile(targetPath, Buffer.alloc(0));
    } else {
      const data = entry.getData();
      outZip.addFile(targetPath, data);
    }
  }

  if (options?.includeServerJar && options?.serverJarPath) {
    try {
      const jarBuffer = await readFile(options.serverJarPath);
      outZip.addFile(prefix + "server.jar", jarBuffer);
    } catch (err) {
      console.warn(
        "[deployment] Could not add server.jar:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const deploymentsRoot = getDeploymentsRoot();
  const projectDir = join(deploymentsRoot, projectId);
  await mkdir(projectDir, { recursive: true });
  const artifactPath = join(projectDir, `${deploymentId}.zip`);
  const buffer = outZip.toBuffer();
  await writeFile(artifactPath, buffer);

  const artifactSha256 = createHash("sha256").update(buffer).digest("hex");
  return {
    artifactPath,
    artifactSize: buffer.length,
    artifactSha256,
  };
}
