import { existsSync } from "fs";
import { mkdir, readFile, readdir, writeFile } from "fs/promises";
import { basename, join, relative } from "path";
import { parse } from "yaml";
import type { StoredProject } from "../types/storage";
import { readProjectFile, resolveProjectRoot, writeProjectFileBuffer } from "./projectFiles";
import type { ProjectPlugin } from "../types/plugins";

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
  cachePath?: string;
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
  plugin: ProjectPlugin,
  options: DownloadOptions = {},
): Promise<DownloadedPluginArtifact> {
  const requestedVersion = plugin.version ?? "latest";
  const pluginId = plugin.id;

  const finalizeArtifact = async (
    artifact: DownloadedPluginArtifact,
    versionHint?: string,
  ): Promise<DownloadedPluginArtifact> => {
    const resolvedVersion = artifact.version ?? versionHint ?? requestedVersion;
    const { cachePath } = await ensurePluginCache(
      pluginId,
      resolvedVersion,
      artifact.fileName,
      artifact.buffer,
    );
    return {
      ...artifact,
      version: resolvedVersion,
      cachePath,
    };
  };

  if (plugin.source?.uploadPath) {
    const absolutePath = join(resolveProjectRoot(project), plugin.source.uploadPath);
    const buffer = await readFile(absolutePath);
    return finalizeArtifact({
      buffer,
      fileName: basename(plugin.source.uploadPath),
      version: requestedVersion,
    });
  }

  if (plugin.source?.downloadUrl) {
    const artifact = await downloadFromHttp(
      { type: "http", url: plugin.source.downloadUrl },
      { pluginId, requestedVersion },
    );
    if (artifact) {
      return finalizeArtifact(artifact, requestedVersion);
    }
    throw new Error(`Failed to download plugin ${pluginId} from ${plugin.source.downloadUrl}`);
  }

  if (plugin.provider) {
    const artifact = await downloadFromProvider(project, plugin, options);
    if (artifact) {
      return finalizeArtifact(artifact, requestedVersion);
    }
    console.warn(
      `Provider download failed for ${plugin.id} via ${plugin.provider}, falling back to registry/local sources.`,
    );
  }

  const registry = await loadPluginRegistry(project);
  // 1. Look for plugin JAR in the project directory or template.
  const local = await readLocalPlugin(project, pluginId, requestedVersion);
  if (local) {
    return finalizeArtifact(local, requestedVersion);
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
        const finalized = await finalizeArtifact(artifact, requestedVersion);
        await writeProjectPlugin(project, finalized.fileName, finalized.buffer);
        return finalized;
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
  const cacheDir = getCacheDir(pluginId, requestedVersion);
  if (!existsSync(cacheDir)) {
    return undefined;
  }

  try {
    const files = await readdir(cacheDir);
    const jarName = files.find((file) => file.endsWith(".jar"));
    if (!jarName) {
      return undefined;
    }
    const absolutePath = join(cacheDir, jarName);
    const buffer = await readFile(absolutePath);
    return {
      buffer,
      fileName: jarName,
      version: requestedVersion,
      cachePath: toRelativeCachePath(absolutePath),
    };
  } catch (error) {
    console.warn(`Failed to read plugin cache for ${pluginId}@${requestedVersion}`, error);
    return undefined;
  }
}

function getCacheDir(pluginId: string, version: string): string {
  return join(CACHE_ROOT, pluginId, version);
}

function toRelativeCachePath(absolutePath: string): string {
  return toPosixPath(relative(process.cwd(), absolutePath));
}

async function ensurePluginCache(
  pluginId: string,
  version: string,
  fileName: string,
  buffer: Buffer,
): Promise<{ cachePath: string }> {
  const cacheDir = getCacheDir(pluginId, version);
  const absolutePath = join(cacheDir, fileName);
  await mkdir(cacheDir, { recursive: true });
  if (!existsSync(absolutePath)) {
    await writeFile(absolutePath, buffer);
  }
  return { cachePath: toRelativeCachePath(absolutePath) };
}

function toPosixPath(pathString: string): string {
  return pathString.replace(/\\/g, "/");
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

async function downloadFromProvider(
  project: StoredProject,
  plugin: ProjectPlugin,
  options: DownloadOptions,
): Promise<DownloadedPluginArtifact | undefined> {
  const source = plugin.source;
  if (!source) return undefined;
  const version = plugin.version ?? "latest";

  switch (source.provider) {
    case "hangar":
      return downloadFromHangar(source.slug, version, project.loader, project.minecraftVersion, options);
    case "modrinth":
      return downloadFromModrinth(source.slug, version, project.loader, project.minecraftVersion);
    case "spiget":
      return downloadFromSpiget(source.slug, version);
    case "github":
      return downloadFromGithub(
        { type: "github", repo: source.slug, assetPattern: source.downloadUrl ?? `${plugin.id}-*.jar` },
        { pluginId: plugin.id, requestedVersion: version, githubToken: options.githubToken },
      );
    case "custom":
      if (source.downloadUrl) {
        return downloadFromHttp(
          { type: "http", url: source.downloadUrl },
          { pluginId: plugin.id, requestedVersion: version },
        );
      }
      return undefined;
    default:
      return undefined;
  }
}

async function downloadFromHangar(
  slug: string,
  requestedVersion: string,
  loader: string,
  mcVersion: string,
  options: DownloadOptions,
): Promise<DownloadedPluginArtifact | undefined> {
  const url = requestedVersion === "latest"
    ? `https://hangar.papermc.io/api/v1/projects/${slug}/versions?platform=${encodeURIComponent(loader)}`
    : `https://hangar.papermc.io/api/v1/projects/${slug}/versions/${encodeURIComponent(requestedVersion)}`;

  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "mc-server-manager",
  };
  if (options.githubToken ?? process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${options.githubToken ?? process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Hangar lookup failed for ${slug}@${requestedVersion}: ${response.statusText}`);
  }

  const data = await response.json();
  const versionData = Array.isArray(data?.result) ? data.result[0] : data;
  if (!versionData) {
    return undefined;
  }

  const files: Array<{ url: string; fileName: string }> = versionData.files ?? versionData.downloads ?? [];
  const file = files.find((candidate) => candidate.fileName?.endsWith(".jar")) ?? files[0];
  if (!file?.url) {
    throw new Error(`Hangar version ${requestedVersion} has no downloadable jar`);
  }

  const downloadUrl = file.url.startsWith("http")
    ? file.url
    : `https://hangarcdn.papermc.io${file.url}`;
  const jarResponse = await fetch(downloadUrl, { headers });
  if (!jarResponse.ok) {
    throw new Error(`Failed to download Hangar artifact for ${slug}: ${jarResponse.statusText}`);
  }
  const buffer = Buffer.from(await jarResponse.arrayBuffer());
  const versionName = versionData.name ?? requestedVersion;
  const fileName = file.fileName ?? `${slug.replace("/", "-")}-${versionName}.jar`;
  return {
    buffer,
    fileName,
    version: versionName,
  };
}

async function downloadFromModrinth(
  projectId: string,
  requestedVersion: string,
  loader: string,
  mcVersion: string,
): Promise<DownloadedPluginArtifact | undefined> {
  const facets = [
    `["project_id:${projectId}"]`,
    `["versions:${mcVersion}"]`,
    `["categories:${loader.toLowerCase()}"]`,
  ];
  const url = `https://api.modrinth.com/v2/project/${projectId}/version`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "mc-server-manager",
    },
  });
  if (!response.ok) {
    throw new Error(`Modrinth lookup failed for ${projectId}: ${response.statusText}`);
  }
  const versions = (await response.json()) as Array<{
    id: string;
    version_number: string;
    game_versions: string[];
    loaders: string[];
    files: Array<{ url: string; filename: string }>;
  }>;
  const match = versions.find((entry) => {
    const versionMatches =
      requestedVersion === "latest" ? true : entry.version_number === requestedVersion;
    const loaderMatches = entry.loaders?.some((item) => item.toLowerCase() === loader.toLowerCase());
    const mcMatches = entry.game_versions?.includes(mcVersion);
    return versionMatches && loaderMatches && mcMatches;
  }) ?? versions.find((entry) => entry.game_versions?.includes(mcVersion));

  if (!match) {
    throw new Error(`No Modrinth version found for ${projectId} supporting ${mcVersion}`);
  }

  const file = match.files.find((item) => item.filename.endsWith(".jar")) ?? match.files[0];
  if (!file) {
    throw new Error(`Modrinth version ${match.version_number} has no downloadable jar`);
  }
  const jarResponse = await fetch(file.url, {
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "mc-server-manager",
    },
  });
  if (!jarResponse.ok) {
    throw new Error(`Failed to download Modrinth artifact: ${jarResponse.statusText}`);
  }
  const buffer = Buffer.from(await jarResponse.arrayBuffer());
  return {
    buffer,
    fileName: file.filename,
    version: match.version_number,
  };
}

async function downloadFromSpiget(
  resourceId: string,
  requestedVersion: string,
): Promise<DownloadedPluginArtifact | undefined> {
  const resourceResponse = await fetch(
    `https://api.spiget.org/v2/resources/${resourceId}`,
  );
  if (!resourceResponse.ok) {
    throw new Error(`Spiget resource lookup failed: ${resourceResponse.statusText}`);
  }
  const resource = (await resourceResponse.json()) as { name: string };

  const versionResponse = await fetch(
    `https://api.spiget.org/v2/resources/${resourceId}/versions?size=50`,
  );
  if (!versionResponse.ok) {
    throw new Error(`Spiget versions lookup failed: ${versionResponse.statusText}`);
  }

  const versions = (await versionResponse.json()) as Array<{
    id: number;
    name: string;
    downloadUrl: string;
  }>;

  const match = versions.find((entry) =>
    requestedVersion === "latest" ? true : entry.name === requestedVersion,
  ) ?? versions[0];

  if (!match) {
    throw new Error(`No Spiget versions available for resource ${resourceId}`);
  }

  const downloadUrl = `https://api.spiget.org/v2/resources/${resourceId}/download/${match.id}.jar`;
  const jarResponse = await fetch(downloadUrl);
  if (!jarResponse.ok) {
    throw new Error(`Failed to download Spiget artifact: ${jarResponse.statusText}`);
  }
  const buffer = Buffer.from(await jarResponse.arrayBuffer());
  const fileName = `${resource.name.replace(/\s+/g, "-")}-${match.name}.jar`;
  return {
    buffer,
    fileName,
    version: match.name ?? requestedVersion,
  };
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


