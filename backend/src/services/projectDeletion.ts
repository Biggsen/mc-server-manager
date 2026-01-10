import { readdir, rm } from "fs/promises";
import { join } from "path";
import type { StoredProject } from "../types/storage";
import { PROJECTS_ROOT } from "./projectFiles";
import { listRuns, stopRun, deleteRunsForProject } from "./runQueue";
import { deleteBuildsForProject } from "./buildQueue";
import type { RunStatus } from "../types/run";
import { getDataRoot } from "../config";

const MANIFEST_DIR = join(getDataRoot(), "data", "manifests");

const ACTIVE_RUN_STATUSES = new Set<RunStatus>(["pending", "running", "stopping"]);

function isActiveStatus(status: RunStatus): boolean {
  return ACTIVE_RUN_STATUSES.has(status);
}

export async function deleteProjectResources(project: StoredProject): Promise<void> {
  const runs = listRuns(project.id);
  for (const run of runs) {
    if (isActiveStatus(run.status)) {
      try {
        await stopRun(run.id);
      } catch (error) {
        console.warn(`Failed to stop run ${run.id} for project ${project.id}`, error);
      }
    }
  }

  await deleteRunsForProject(project.id);
  await deleteBuildsForProject(project.id);

  await rm(join(PROJECTS_ROOT, project.id), { recursive: true, force: true }).catch(() => {});

  try {
    const entries = await readdir(MANIFEST_DIR);
    await Promise.all(
      entries
        .filter((entry) => entry.startsWith(`${project.id}-`) && entry.endsWith(".json"))
        .map((entry) => rm(join(MANIFEST_DIR, entry), { force: true })),
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn(`Failed to clean manifests for project ${project.id}`, error);
    }
  }
}


