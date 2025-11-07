import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { v4 as uuid } from "uuid";
import { getManifestFilePath, recordManifestMetadata } from "../storage/projectsStore";
import type { StoredProject } from "../types/storage";
import type { BuildJob } from "../types/build";
import { renderManifest, type ManifestOverrides } from "./manifestService";

const DATA_DIR = join(process.cwd(), "data", "builds");
const LOG_PATH = join(DATA_DIR, "builds.json");

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
  void runBuild(jobId, project, overrides);
  await persistBuilds();
  return job;
}

async function runBuild(
  jobId: string,
  project: StoredProject,
  overrides: ManifestOverrides,
): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  job.status = "running";
  job.startedAt = new Date().toISOString();
  jobs.set(jobId, job);

  try {
    // Simulate manifest + packaging steps
    const buildId = new Date().toISOString().replace(/[:.]/g, "-");
    const manifestContent = await renderManifest(project, buildId, overrides);
    const manifestPath = getManifestFilePath(project.id, buildId);

    await writeFile(manifestPath, manifestContent, "utf-8");

    await recordManifestMetadata(project.id, {
      lastBuildId: buildId,
      manifestPath,
      generatedAt: new Date().toISOString(),
    });

    job.status = "succeeded";
    job.finishedAt = new Date().toISOString();
    job.manifestBuildId = buildId;
    job.manifestPath = manifestPath;
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

