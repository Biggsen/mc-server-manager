import { writeFile } from "fs/promises";
import { v4 as uuid } from "uuid";
import { getManifestFilePath, recordManifestMetadata } from "../storage/projectsStore";
import type { StoredProject } from "../types/storage";
import type { BuildJob } from "../types/build";
import { renderManifest, type ManifestOverrides } from "./manifestService";

const jobs = new Map<string, BuildJob>();

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
  } catch (error) {
    job.status = "failed";
    job.finishedAt = new Date().toISOString();
    job.error = error instanceof Error ? error.message : "Unknown build error";
    jobs.set(jobId, job);
  }
}

