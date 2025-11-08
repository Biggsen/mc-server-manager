import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { v4 as uuid } from "uuid";
import { ZipFile } from "yazl";
import {
  getManifestFilePath,
  recordManifestMetadata,
  setProjectAssets,
} from "../storage/projectsStore";
import type { RepoMetadata, StoredProject } from "../types/storage";
import type { BuildJob } from "../types/build";
import { renderManifest, type ManifestOverrides } from "./manifestService";
import {
  collectProjectDefinitionFiles,
  readProjectFile,
  renderConfigFiles,
  resolveProjectRoot,
  writeProjectFileBuffer,
} from "./projectFiles";
import { scanProjectAssets } from "./projectScanner";
import { commitFiles, getOctokitWithToken } from "./githubClient";
import { fetchPluginArtifact } from "./pluginRegistry";
import type { ProjectPlugin } from "../types/plugins";

const DATA_DIR = join(process.cwd(), "data", "builds");
const LOG_PATH = join(DATA_DIR, "builds.json");
const DIST_DIR = join(DATA_DIR, "dist");

interface PluginMaterialization {
  id: string;
  version: string;
  sha256: string;
  relativePath: string;
  buffer: Buffer;
}

interface ConfigMaterialization {
  path: string;
  content: string;
  sha256: string;
}

interface EnqueueOptions {
  overrides?: ManifestOverrides;
  githubToken?: string;
}

const jobs = new Map<string, BuildJob>();

void loadBuildsFromDisk();

export function listBuilds(projectId?: string): BuildJob[] {
  return Array.from(jobs.values())
    .filter((job) => (projectId ? job.projectId === projectId : true))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getBuild(jobId: string): BuildJob | undefined {
  return jobs.get(jobId);
}

export async function enqueueBuild(
  project: StoredProject,
  overrides: ManifestOverrides = {},
  options: EnqueueOptions = {},
): Promise<BuildJob> {
  const jobId = uuid();
  const createdAt = new Date().toISOString();
  const job: BuildJob = {
    id: jobId,
    projectId: project.id,
    status: "pending",
    createdAt,
  };

  jobs.set(jobId, job);
  void runBuild(jobId, project, overrides, options);
  await persistBuilds();
  return job;
}

async function runBuild(
  jobId: string,
  project: StoredProject,
  overrides: ManifestOverrides,
  options: EnqueueOptions,
): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  job.status = "running";
  job.startedAt = new Date().toISOString();
  jobs.set(jobId, job);

  try {
    const buildId = new Date().toISOString().replace(/[:.]/g, "-");
    const projectWithAssets = await ensureProjectAssets(project);

    const definitionFiles = await collectProjectDefinitionFiles(projectWithAssets);
    const plugins = await materializePlugins(projectWithAssets, {
      githubToken: options.githubToken,
    });
    const configs = await materializeConfigs(projectWithAssets);

    const updatedProject =
      (await setProjectAssets(project.id, {
        plugins: plugins.map(({ id, version, sha256 }) => ({ id, version, sha256 })),
        configs: configs.map(({ path, sha256 }) => ({ path, sha256 })),
      })) ?? {
        ...projectWithAssets,
        plugins: plugins.map(({ id, version, sha256 }) => ({ id, version, sha256 })),
        configs: configs.map(({ path, sha256 }) => ({ path, sha256 })),
      };

    const artifactRelativePath = `dist/${project.id}-${buildId}.zip`;
    const artifactPath = join(DATA_DIR, project.id, `${buildId}.zip`);
    const distPath = join(DIST_DIR, `${project.id}-${buildId}.zip`);

    const zipEntries = new Map<string, Buffer>();
    for (const [path, content] of Object.entries(definitionFiles)) {
      zipEntries.set(path, Buffer.from(content, "utf-8"));
    }
    for (const config of configs) {
      zipEntries.set(config.path, Buffer.from(config.content, "utf-8"));
    }
    for (const plugin of plugins) {
      zipEntries.set(plugin.relativePath, plugin.buffer);
    }

    const zipBuffer = await createArtifactZip(
      Array.from(zipEntries.entries()).map(([path, buffer]) => ({ path, buffer })),
    );

    await mkdir(dirname(artifactPath), { recursive: true });
    await mkdir(DIST_DIR, { recursive: true });
    await writeFile(artifactPath, zipBuffer);
    await writeFile(distPath, zipBuffer);

    const artifactSha = hashBuffer(zipBuffer);
    const artifactSize = zipBuffer.length;

    const manifestOverrides: ManifestOverrides = {
      ...overrides,
      plugins: plugins.map(({ id, version, sha256 }) => ({ id, version, sha256 })),
      configs: configs.map(({ path, sha256 }) => ({ path, sha256 })),
      artifact: {
        zipPath: artifactRelativePath,
        sha256: artifactSha,
        size: artifactSize,
      },
    };

    const manifestPath = getManifestFilePath(project.id, buildId);
    const manifestContent = await renderManifest(updatedProject, buildId, manifestOverrides);
    await writeFile(manifestPath, manifestContent, "utf-8");

    const metadata = {
      lastBuildId: buildId,
      manifestPath,
      generatedAt: new Date().toISOString(),
      commitSha: undefined as string | undefined,
    };

    if (options.githubToken && updatedProject.repo) {
      await pushBuildToRepository({
        project: updatedProject,
        buildId,
        manifestContent,
        artifactRelativePath,
        zipBuffer,
        metadata,
        overrides: manifestOverrides,
      }, options.githubToken);
    }

    await recordManifestMetadata(project.id, metadata);

    job.status = "succeeded";
    job.finishedAt = new Date().toISOString();
    job.manifestBuildId = buildId;
    job.manifestPath = manifestPath;
    job.artifactPath = distPath;
    job.artifactSha = artifactSha;
    jobs.set(jobId, job);
    await persistBuilds();
  } catch (error) {
    job.status = "failed";
    job.finishedAt = new Date().toISOString();
    job.error = error instanceof Error ? error.message : "Unknown build error";
    jobs.set(jobId, job);
    await persistBuilds();
  }
}

async function loadBuildsFromDisk(): Promise<void> {
  try {
    const raw = await readFile(LOG_PATH, "utf-8");
    const snapshot = JSON.parse(raw) as { builds?: BuildJob[] };
    for (const build of snapshot.builds ?? []) {
      if (!build.createdAt) {
        build.createdAt = new Date().toISOString();
      }
      jobs.set(build.id, build);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn("Failed to read build history", error);
    }
  }
}

async function persistBuilds(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const snapshot = Array.from(jobs.values()).sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1,
  );
  await writeFile(LOG_PATH, JSON.stringify({ builds: snapshot }, null, 2), "utf-8");
}

async function ensureProjectAssets(project: StoredProject): Promise<StoredProject> {
  if (project.plugins?.length && project.configs?.length) {
    return project;
  }

  const scanned = await scanProjectAssets(project);
  return (
    (await setProjectAssets(project.id, {
      plugins: scanned.plugins,
      configs: scanned.configs,
    })) ?? project
  );
}

function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function materializePlugins(
  project: StoredProject,
  options: { githubToken?: string },
): Promise<PluginMaterialization[]> {
  const results: PluginMaterialization[] = [];

  for (const plugin of project.plugins ?? []) {
    const artifact = await fetchPluginArtifact(project, plugin, {
      githubToken: options.githubToken,
    });

    const buffer = artifact.buffer;
    const version = artifact.version ?? plugin.version;
    const sha256 = hashBuffer(buffer);
    const relativePath = `plugins/${artifact.fileName}`;

    // Materialize to the project workspace for future scans.
    await writeProjectFileBuffer(project, relativePath, buffer);

    results.push({
      id: plugin.id,
      version,
      sha256,
      relativePath,
      buffer,
    });
  }

  return results;
}

async function materializeConfigs(project: StoredProject): Promise<ConfigMaterialization[]> {
  const rendered = await renderConfigFiles(project);
  const renderedMap = new Map(rendered.map((item) => [item.path, item.content]));

  const uniquePaths = new Set<string>([
    ...(project.configs?.map((config) => config.path) ?? []),
    ...rendered.map((item) => item.path),
  ]);

  const results: ConfigMaterialization[] = [];
  for (const path of uniquePaths) {
    let content = renderedMap.get(path);
    if (!content) {
      content = await readProjectFile(project, path);
    }
    if (!content) continue;

    await writeProjectFileBuffer(project, path, Buffer.from(content, "utf-8"));

    const sha256 = hashBuffer(Buffer.from(content, "utf-8"));
    results.push({
      path,
      content,
      sha256,
    });
  }

  return results;
}

async function createArtifactZip(
  entries: Array<{ path: string; buffer: Buffer }>,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const zipfile = new ZipFile();
    const chunks: Buffer[] = [];

    zipfile.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zipfile.outputStream.on("error", reject);
    zipfile.outputStream.on("end", () => resolve(Buffer.concat(chunks)));

    for (const entry of entries) {
      zipfile.addBuffer(entry.buffer, entry.path, {
        mtime: new Date(0),
        mode: 0o100644,
      });
    }

    zipfile.end();
  });
}

async function pushBuildToRepository(
  params: {
    project: StoredProject;
    buildId: string;
    manifestContent: string;
    artifactRelativePath: string;
    zipBuffer: Buffer;
    metadata: { commitSha?: string };
    overrides: ManifestOverrides;
  },
  githubToken: string,
): Promise<void> {
  const repo = params.project.repo as RepoMetadata | undefined;
  if (!repo) {
    return;
  }

  const octokit = getOctokitWithToken(githubToken);
  const branch = repo.defaultBranch ?? params.project.defaultBranch ?? "main";

  const files = {
    [`manifests/${params.buildId}.json`]: params.manifestContent,
    [params.artifactRelativePath]: {
      content: params.zipBuffer.toString("base64"),
      encoding: "base64" as const,
    },
  };

  const { commitSha } = await commitFiles(octokit, {
    owner: repo.owner,
    repo: repo.name,
    branch,
    message: `build: ${params.project.id} (${params.buildId})`,
    files,
  });

  params.metadata.commitSha = commitSha;

  const manifestPath = getManifestFilePath(params.project.id, params.buildId);
  const manifestWithCommit = await renderManifest(params.project, params.buildId, {
    ...params.overrides,
    repository: {
      commit: commitSha,
    },
  });
  await writeFile(manifestPath, manifestWithCommit, "utf-8");
}


