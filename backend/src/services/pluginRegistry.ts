import { existsSync } from "fs";
import { mkdir, readFile, readdir, writeFile } from "fs/promises";
import { basename, join } from "path";
import { parse } from "yaml";
import type { StoredProject } from "../types/storage";
import { readProjectFile, resolveProjectRoot, writeProjectFileBuffer } from "./projectFiles";

interface PluginSourceGithub {
  type: "github";
  repo: string;
  assetPattern: string;
}

interface PluginSourceHttp {
  type: "http";
  url: string;
  fileName?: string;
}

type PluginSource = PluginSourceGithub | PluginSourceHttp;

interface PluginDefinition {
  displayName?: string;
  sources?: PluginSource[];
}

interface PluginRegistry {
  schema: number;
  plugins: Record<string, PluginDefinition>;
}

interface DownloadOptions {
  githubToken?: string;
}

export interface DownloadedPluginArtifact {
  fileName: string;
  buffer: Buffer;
  version: string;
}

const REGISTRY_PATH = "plugins/registry.yml";
const CACHE_ROOT = join(process.cwd(), "data", "cache", "plugins");

export async function loadPluginRegistry(project: StoredProject): Promise<PluginRegistry> {
  const contents = await readProjectFile(project, REGISTRY_PATH);
  if (!contents) {
    return { schema: 1, plugins: {} };
  }

  try {
    const parsed = parse(contents) as PluginRegistry | undefined;
    if (!parsed || typeof parsed !== "object" || !parsed.plugins) {
      throw new Error("Invalid registry file");
    }
    return parsed;
  } catch (error) {
    console.warn(`Failed to parse plugin registry for project ${project.id}`, error);
    return { schema: 1, plugins: {} };
  }
}

export async function fetchPluginArtifact(
  project: StoredProject,
  registry: PluginRegistry,
  pluginId: string,
  requestedVersion: string,
  options: DownloadOptions = {},
): Promise<DownloadedPluginArtifact> {
  // 1. Look for plugin JAR in the project directory or template.
  const local = await readLocalPlugin(project, pluginId, requestedVersion);
  if (local) {
    return local;
  }

  // 2. Look for cached artifact.
  const cached = await readCachedPlugin(pluginId, requestedVersion);
  if (cached) {
    await writeProjectPlugin(project, cached.fileName, cached.buffer);
    return cached;
  }

  // 3. Download from registry sources.
  const definition = registry.plugins?.[pluginId];
  if (!definition?.sources?.length) {
    throw new Error(
      `No sources configured for plugin "${pluginId}". Add it to ${REGISTRY_PATH}.`,
    );
  }

  let downloadError: Error | undefined;
  for (const source of definition.sources) {
    try {
      const artifact = await downloadFromSource(source, {
        pluginId,
        requestedVersion,
        githubToken: options.githubToken,
      });

      if (artifact) {
        await cachePlugin(pluginId, artifact.version, artifact.fileName, artifact.buffer);
        await writeProjectPlugin(project, artifact.fileName, artifact.buffer);
        return artifact;
      }
    } catch (error) {
      downloadError = error instanceof Error ? error : new Error(String(error));
      console.warn(
        `Failed to download plugin ${pluginId} from source ${JSON.stringify(source)}`,
        downloadError,
      );
    }
  }

  if (downloadError) {
    throw downloadError;
  }

  throw new Error(`Unable to resolve plugin "${pluginId}" from configured sources`);
}

async function readLocalPlugin(
  project: StoredProject,
  pluginId: string,
  requestedVersion: string,
): Promise<DownloadedPluginArtifact | undefined> {
  const root = resolveProjectRoot(project);
  const existingNames = [
    `${pluginId}-${requestedVersion}.jar`,
    `${pluginId}.jar`,
  ];

  for (const name of existingNames) {
    const path = join(root, "plugins", name);
    try {
      const buffer = await readFile(path);
      return {
        buffer,
        fileName: name,
        version: requestedVersion,
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        console.warn(`Failed to read local plugin file at ${path}`, error);
      }
    }
  }

  return undefined;
}

async function readCachedPlugin(
  pluginId: string,
  requestedVersion: string,
): Promise<DownloadedPluginArtifact | undefined> {
  const cacheDir = join(CACHE_ROOT, pluginId, requestedVersion);
  if (!existsSync(cacheDir)) {
    return undefined;
  }

  try {
    const files = await readdir(cacheDir);
    const jarName = files.find((file) => file.endsWith(".jar"));
    if (!jarName) {
      return undefined;
    }
    const buffer = await readFile(join(cacheDir, jarName));
    return {
      buffer,
      fileName: jarName,
      version: requestedVersion,
    };
  } catch (error) {
    console.warn(`Failed to read plugin cache for ${pluginId}@${requestedVersion}`, error);
    return undefined;
  }
}

async function cachePlugin(
  pluginId: string,
  version: string,
  fileName: string,
  buffer: Buffer,
): Promise<void> {
  const cacheDir = join(CACHE_ROOT, pluginId, version);
  await mkdir(cacheDir, { recursive: true });
  await writeFile(join(cacheDir, fileName), buffer);
}

async function writeProjectPlugin(
  project: StoredProject,
  fileName: string,
  buffer: Buffer,
): Promise<void> {
  await writeProjectFileBuffer(project, join("plugins", fileName), buffer);
}

async function downloadFromSource(
  source: PluginSource,
  context: {
    pluginId: string;
    requestedVersion: string;
    githubToken?: string;
  },
): Promise<DownloadedPluginArtifact | undefined> {
  if (source.type === "github") {
    return downloadFromGithub(source, context);
  }
  if (source.type === "http") {
    return downloadFromHttp(source, context);
  }
  return undefined;
}

async function downloadFromGithub(
  source: PluginSourceGithub,
  context: {
    pluginId: string;
    requestedVersion: string;
    githubToken?: string;
  },
): Promise<DownloadedPluginArtifact | undefined> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "mc-server-manager",
  };
  if (context.githubToken ?? process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${context.githubToken ?? process.env.GITHUB_TOKEN}`;
  }

  const version = context.requestedVersion;
  const releaseUrl =
    version === "latest"
      ? `https://api.github.com/repos/${source.repo}/releases/latest`
      : `https://api.github.com/repos/${source.repo}/releases/tags/${encodeURIComponent(version)}`;

  const releaseResponse = await fetchWithRetry(releaseUrl, headers);
  if (!releaseResponse.ok) {
    throw new Error(
      `GitHub release lookup failed for ${source.repo}@${version}: ${releaseResponse.statusText}`,
    );
  }

  const release = (await releaseResponse.json()) as {
    tag_name?: string;
    assets?: Array<{ name: string; browser_download_url: string }>;
  };

  const resolvedVersion = release.tag_name ?? version;
  const assets = release.assets ?? [];
  const pattern = patternToRegex(source.assetPattern);
  const asset = assets.find((candidate) => pattern.test(candidate.name));

  if (!asset) {
    throw new Error(
      `No asset matching pattern "${source.assetPattern}" found for ${source.repo}@${resolvedVersion}`,
    );
  }

  const assetResponse = await fetchWithRetry(asset.browser_download_url, headers);
  if (!assetResponse.ok) {
    throw new Error(
      `Failed to download asset ${asset.name} for ${source.repo}@${resolvedVersion}: ${assetResponse.statusText}`,
    );
  }

  const arrayBuffer = await assetResponse.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return {
    buffer,
    fileName: asset.name,
    version: resolvedVersion,
  };
}

async function downloadFromHttp(
  source: PluginSourceHttp,
  context: {
    pluginId: string;
    requestedVersion: string;
  },
): Promise<DownloadedPluginArtifact | undefined> {
  const response = await fetchWithRetry(source.url);
  if (!response.ok) {
    throw new Error(
      `Failed to download plugin ${context.pluginId} from ${source.url}: ${response.statusText}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const fileName =
    source.fileName ??
    basename(new URL(response.url).pathname) ??
    `${context.pluginId}-${context.requestedVersion}.jar`;

  return {
    buffer,
    fileName,
    version: context.requestedVersion,
  };
}

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

async function fetchWithRetry(
  url: string,
  headers?: Record<string, string>,
  attempt = 0,
): Promise<Response> {
  const response = await fetch(url, { headers });
  if (response.status === 429 && attempt < 2) {
    const delayMs = Number(response.headers.get("retry-after") ?? "1") * 1000;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return fetchWithRetry(url, headers, attempt + 1);
  }
  return response;
}


