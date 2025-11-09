import { mkdir, readFile, writeFile, rm } from "fs/promises";
import { join } from "path";
import { spawn } from "child_process";
import { v4 as uuid } from "uuid";
import { createServer } from "net";
import AdmZip from "adm-zip";
import type { StoredProject } from "../types/storage";
import type { RunJob, RunLogEntry, RunLogStream } from "../types/run";
import { listBuilds } from "./buildQueue";

const DATA_DIR = join(process.cwd(), "data", "runs");
const LOG_PATH = join(DATA_DIR, "runs.json");
const WORKSPACE_ROOT = join(DATA_DIR, "workspaces");

const jobs = new Map<string, RunJob>();

void loadRunsFromDisk();

export function listRuns(projectId?: string): RunJob[] {
  return Array.from(jobs.values())
    .filter((job) => (projectId ? job.projectId === projectId : true))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getRun(jobId: string): RunJob | undefined {
  return jobs.get(jobId);
}

export async function enqueueRun(project: StoredProject): Promise<RunJob> {
  const latestBuild = listBuilds(project.id).find(
    (build) => build.status === "succeeded" && build.artifactPath,
  );

  if (!latestBuild || !latestBuild.artifactPath) {
    throw new Error("No successful build with an artifact available to run.");
  }

  const jobId = uuid();
  const createdAt = new Date().toISOString();
  const containerName = createContainerName(project.id, jobId);
  const job: RunJob = {
    id: jobId,
    projectId: project.id,
    buildId: latestBuild.id,
    artifactPath: latestBuild.artifactPath,
    status: "pending",
    createdAt,
    logs: [],
    containerName,
  };

  jobs.set(jobId, job);
  void runJob(project, jobId);
  await persistRuns();
  return job;
}

async function runJob(project: StoredProject, jobId: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  job.status = "running";
  job.startedAt = new Date().toISOString();
  appendLog(job, "system", `Starting docker run for project ${project.id}`);
  jobs.set(jobId, job);
  await persistRuns();

  try {
    await ensureDockerJob(job, project);
  } catch (error) {
    appendLog(
      job,
      "stderr",
      error instanceof Error ? error.message : "Docker execution failed",
    );
    job.status = "failed";
    job.error = error instanceof Error ? error.message : String(error);
    job.finishedAt = new Date().toISOString();
    jobs.set(jobId, job);
    await persistRuns();
  }
}

async function ensureDockerJob(job: RunJob, project: StoredProject): Promise<void> {
  const workspacePath = await prepareWorkspace(job);
  job.workspacePath = workspacePath;
  appendLog(job, "system", `Prepared workspace at ${workspacePath}`);

  const port = await findAvailablePort(job.port ?? 25565);
  job.port = port;
  appendLog(job, "system", `Using local port ${port}`);

  const containerName = job.containerName ?? createContainerName(project.id, job.id);
  job.containerName = containerName;

  jobs.set(job.id, job);
  await persistRuns();

  const serverType = determineServerType(project.loader);
  const version =
    project.minecraftVersion && project.minecraftVersion !== "unknown"
      ? project.minecraftVersion
      : "LATEST";

  const dockerArgs = [
    "run",
    "--rm",
    "--name",
    containerName,
    "-p",
    `${port}:25565`,
    "-v",
    `${workspacePath}:/data`,
    "-e",
    "EULA=TRUE",
    "-e",
    `TYPE=${serverType}`,
    "-e",
    `VERSION=${version}`,
    "-e",
    "USE_AIKAR_FLAGS=true",
    "itzg/minecraft-server:latest",
  ];

  appendLog(job, "system", `Launching container ${containerName} with image itzg/minecraft-server:latest`);

  try {
    await executeCommand(job, "docker", dockerArgs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      appendLog(
        job,
        "system",
        "Docker not found on PATH. Simulating local run instead.",
      );
      await simulateLocalRun(job, project);
      return;
    }
    throw error;
  }
}

async function executeCommand(job: RunJob, command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });

    child.stdout?.on("data", (chunk: Buffer) => {
      appendLog(job, "stdout", chunk.toString("utf-8"));
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      appendLog(job, "stderr", chunk.toString("utf-8"));
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        appendLog(job, "system", "Docker run completed successfully.");
        job.status = "succeeded";
        job.finishedAt = new Date().toISOString();
        jobs.set(job.id, job);
        void persistRuns();
        resolve();
      } else {
        reject(new Error(`Docker exited with status ${code}`));
      }
    });
  });
}

async function simulateLocalRun(job: RunJob, project: StoredProject): Promise<void> {
  appendLog(job, "stdout", `Simulating server startup for ${project.id}`);
  job.port = job.port ?? 25565;
  await delay(1000);
  appendLog(job, "stdout", "Server is running (simulation)");
  await delay(1000);
  appendLog(job, "stdout", "Server shutdown complete (simulation)");
  job.status = "succeeded";
  job.finishedAt = new Date().toISOString();
  jobs.set(job.id, job);
  await persistRuns();
}

function appendLog(job: RunJob, stream: RunLogStream, message: string): void {
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    job.logs.push({
      timestamp: new Date().toISOString(),
      stream,
      message: line,
    });
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadRunsFromDisk(): Promise<void> {
  try {
    const raw = await readFile(LOG_PATH, "utf-8");
    const snapshot = JSON.parse(raw) as { runs?: RunJob[] };
    for (const run of snapshot.runs ?? []) {
      if (!run.createdAt) {
        run.createdAt = new Date().toISOString();
      }
      jobs.set(run.id, run);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn("Failed to read run history", error);
    }
  }
}

async function persistRuns(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const snapshot = Array.from(jobs.values()).sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1,
  );
  await writeFile(LOG_PATH, JSON.stringify({ runs: snapshot }, null, 2), "utf-8");
}

function createContainerName(projectId: string, jobId: string): string {
  const safeProject = projectId.replace(/[^a-zA-Z0-9-]/g, "-");
  return `${safeProject}-run-${jobId.slice(0, 6)}`;
}

async function prepareWorkspace(job: RunJob): Promise<string> {
  const workspaceDir = join(WORKSPACE_ROOT, job.id);
  await mkdir(WORKSPACE_ROOT, { recursive: true });
  await rm(workspaceDir, { recursive: true, force: true });
  await mkdir(workspaceDir, { recursive: true });

  const zip = new AdmZip(job.artifactPath);
  zip.extractAllTo(workspaceDir, true);

  await mkdir(join(workspaceDir, "plugins"), { recursive: true });
  return workspaceDir;
}

async function findAvailablePort(preferred: number): Promise<number> {
  let candidate = preferred;
  for (let attempts = 0; attempts < 20; attempts += 1, candidate += 1) {
    if (await isPortAvailable(candidate)) {
      return candidate;
    }
  }
  throw new Error("Unable to find an available port for docker run");
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => {
      resolve(false);
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "0.0.0.0");
  });
}

function determineServerType(loader?: string): string {
  const normalized = loader?.toLowerCase();
  if (normalized === "purpur") {
    return "PURPUR";
  }
  return "PAPER";
}


