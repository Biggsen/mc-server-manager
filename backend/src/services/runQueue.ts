import { mkdir, readFile, writeFile, rm, stat } from "fs/promises";
import { join, dirname } from "path";
import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { v4 as uuid } from "uuid";
import { createServer } from "net";
import { createHash } from "crypto";
import AdmZip from "adm-zip";
import type { Writable } from "stream";
import type { StoredProject } from "../types/storage";
import type { RunJob, RunLogEntry, RunLogStream, RunWorkspaceStatus } from "../types/run";
import { listBuilds } from "./buildQueue";

const DATA_DIR = join(process.cwd(), "data", "runs");
const LOG_PATH = join(DATA_DIR, "runs.json");
const WORKSPACE_ROOT = join(DATA_DIR, "workspaces");
const WORKSPACE_STATE_FILENAME = ".workspace-state.json";

const jobs = new Map<string, RunJob>();
const processes = new Map<string, ChildProcess>();
const stdinStreams = new Map<string, Writable>();
const runEvents = new EventEmitter();
runEvents.setMaxListeners(0);

interface WorkspaceState {
  lastBuildId?: string;
  lastSyncedAt?: string;
  baselineHashes: Record<string, string>;
  dirtyPaths: string[];
}

void loadRunsFromDisk();

export function listRuns(projectId?: string): RunJob[] {
  return Array.from(jobs.values())
    .filter((job) => (projectId ? job.projectId === projectId : true))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getRun(jobId: string): RunJob | undefined {
  return jobs.get(jobId);
}

export async function deleteRunsForProject(projectId: string): Promise<void> {
  let changed = false;
  for (const job of Array.from(jobs.values())) {
    if (job.projectId !== projectId) {
      continue;
    }
    jobs.delete(job.id);
    changed = true;
  }

  if (changed) {
    await persistRuns();
  }

  const projectWorkspace = getProjectWorkspacePath(projectId);
  await rm(projectWorkspace, { recursive: true, force: true }).catch(() => {});
}

export type RunStreamEvent =
  | { type: "run-update"; run: RunJob }
  | { type: "run-log"; runId: string; projectId: string; entry: RunLogEntry };

export function subscribeRunEvents(listener: (event: RunStreamEvent) => void): () => void {
  const updateHandler = (run: RunJob) => listener({ type: "run-update", run });
  const logHandler = (payload: { runId: string; projectId: string; entry: RunLogEntry }) =>
    listener({ type: "run-log", ...payload });

  runEvents.on("run-update", updateHandler);
  runEvents.on("run-log", logHandler);
  return () => {
    runEvents.off("run-update", updateHandler);
    runEvents.off("run-log", logHandler);
  };
}

function emitRunUpdate(run: RunJob): void {
  runEvents.emit("run-update", cloneRun(run));
}

function emitRunLog(run: RunJob, entry: RunLogEntry): void {
  runEvents.emit("run-log", {
    runId: run.id,
    projectId: run.projectId,
    entry: { ...entry },
  });
}

function cloneRun(run: RunJob): RunJob {
  return JSON.parse(JSON.stringify(run)) as RunJob;
}

export async function enqueueRun(project: StoredProject): Promise<RunJob> {
  const existingActive = Array.from(jobs.values()).find(
    (run) =>
      run.projectId === project.id &&
      (run.status === "pending" || run.status === "running" || run.status === "stopping"),
  );

  if (existingActive) {
    throw new Error("A local run is already active for this project.");
  }

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
  emitRunUpdate(job);
  void runJob(project, jobId);
  await persistRuns();
  return job;
}

export async function stopRun(jobId: string): Promise<RunJob> {
  const job = jobs.get(jobId);
  if (!job) {
    throw new Error("Run not found.");
  }

  if (job.status === "succeeded" || job.status === "failed" || job.status === "stopped") {
    return job;
  }

  appendLog(job, "system", "Stop requested.");
  job.status = "stopping";
  jobs.set(jobId, job);
  emitRunUpdate(job);
  await persistRuns();

  const containerName = job.containerName;
  if (containerName) {
    try {
      await stopDockerContainer(job, containerName);
    } catch (error) {
      appendLog(
        job,
        "stderr",
        error instanceof Error ? error.message : "Failed to stop docker container",
      );
    }
  }

  const child = processes.get(jobId);
  if (child && !child.killed) {
    child.kill();
  }
  processes.delete(jobId);
  stdinStreams.delete(jobId);

  job.status = "stopped";
  job.finishedAt = new Date().toISOString();
  job.consoleAvailable = false;
  jobs.set(jobId, job);
  await persistRuns();
  emitRunUpdate(job);
  return job;
}

async function runJob(project: StoredProject, jobId: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  if (job.status === "stopped" || job.status === "stopping") {
    appendLog(job, "system", "Run was stopped before start; skipping execution.");
    job.status = "stopped";
    job.finishedAt = job.finishedAt ?? new Date().toISOString();
    jobs.set(jobId, job);
    emitRunUpdate(job);
    await persistRuns();
    return;
  }

  job.status = "running";
  job.startedAt = new Date().toISOString();
  appendLog(job, "system", `Starting docker run for project ${project.id}`);
  jobs.set(jobId, job);
  emitRunUpdate(job);
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
    emitRunUpdate(job);
    await persistRuns();
  }
}

async function ensureDockerJob(job: RunJob, project: StoredProject): Promise<void> {
  const workspacePath = await prepareWorkspace(job, project);
  job.workspacePath = workspacePath;
  appendLog(job, "system", `Prepared workspace at ${workspacePath}`);

  const port = await findAvailablePort(job.port ?? 25565);
  job.port = port;
  appendLog(job, "system", `Using local port ${port}`);

  const containerName = job.containerName ?? createContainerName(project.id, job.id);
  job.containerName = containerName;

  jobs.set(job.id, job);
  emitRunUpdate(job);
  await persistRuns();

  const serverType = determineServerType(project.loader);
  const version =
    project.minecraftVersion && project.minecraftVersion !== "unknown"
      ? project.minecraftVersion
      : "LATEST";

  const dockerArgs = [
    "run",
    "--rm",
    "-i",
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
    "-e",
    "MEMORY=4G",
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
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    processes.set(job.id, child);

    if (child.stdin) {
      child.stdin.setDefaultEncoding("utf-8");
      stdinStreams.set(job.id, child.stdin);
      const currentJob = jobs.get(job.id);
      if (currentJob) {
        currentJob.consoleAvailable = true;
        jobs.set(currentJob.id, currentJob);
        emitRunUpdate(currentJob);
        void persistRuns();
      }
    }

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
      processes.delete(job.id);
      stdinStreams.delete(job.id);
      const currentJob = jobs.get(job.id);
      if (!currentJob) {
        resolve();
        return;
      }

      if (currentJob.consoleAvailable) {
        currentJob.consoleAvailable = false;
      }

      if (currentJob.status === "stopping" || currentJob.status === "stopped") {
        currentJob.status = "stopped";
        currentJob.finishedAt = currentJob.finishedAt ?? new Date().toISOString();
        jobs.set(currentJob.id, currentJob);
        emitRunUpdate(currentJob);
        void persistRuns();
        resolve();
        return;
      }

      if (code === 0) {
        appendLog(job, "system", "Docker run completed successfully.");
        currentJob.status = "succeeded";
        currentJob.finishedAt = new Date().toISOString();
        jobs.set(currentJob.id, currentJob);
        emitRunUpdate(currentJob);
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
  job.consoleAvailable = false;
  job.port = job.port ?? 25565;
  for (let step = 0; step < 2; step += 1) {
    if (job.status === "stopping" || job.status === "stopped") {
      appendLog(job, "system", "Simulation interrupted by stop request.");
      job.status = "stopped";
      job.finishedAt = new Date().toISOString();
      jobs.set(job.id, job);
      emitRunUpdate(job);
      await persistRuns();
      return;
    }
    await delay(1000);
    appendLog(job, "stdout", step === 0 ? "Server is running (simulation)" : "Server shutdown complete (simulation)");
  }
  job.status = "succeeded";
  job.finishedAt = new Date().toISOString();
  jobs.set(job.id, job);
  emitRunUpdate(job);
  await persistRuns();
}

function appendLog(job: RunJob, stream: RunLogStream, message: string): void {
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    const entry: RunLogEntry = {
      timestamp: new Date().toISOString(),
      stream,
      message: line,
    };
    job.logs.push(entry);
    emitRunLog(job, entry);
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

async function stopDockerContainer(job: RunJob, containerName: string): Promise<void> {
  appendLog(job, "system", `Stopping docker container ${containerName}`);
  await new Promise<void>((resolve, reject) => {
    const stopper = spawn("docker", ["stop", containerName], { stdio: ["ignore", "pipe", "pipe"] });

    stopper.stdout?.on("data", (chunk: Buffer) => {
      appendLog(job, "stdout", chunk.toString("utf-8"));
    });

    stopper.stderr?.on("data", (chunk: Buffer) => {
      appendLog(job, "stderr", chunk.toString("utf-8"));
    });

    stopper.on("error", (error) => {
      reject(error);
    });

    stopper.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`docker stop exited with status ${code}`));
      }
    });
  }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      appendLog(job, "system", "Docker CLI not found while attempting to stop container.");
      return;
    }
    throw error;
  });
}

function createContainerName(projectId: string, jobId: string): string {
  const safeProject = projectId.replace(/[^a-zA-Z0-9-]/g, "-");
  return `${safeProject}-run-${jobId.slice(0, 6)}`;
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

export async function sendRunCommand(runId: string, command: string): Promise<void> {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("Command cannot be empty.");
  }

  const job = jobs.get(runId);
  if (!job) {
    throw new Error("Run not found.");
  }

  if (job.status !== "running") {
    throw new Error("Run is not accepting commands.");
  }

  const stdin = stdinStreams.get(runId);
  if (!stdin) {
    throw new Error("Command channel is not available.");
  }

  try {
    stdin.write(`${trimmed}\n`);
  } catch (error) {
    throw new Error("Command channel is not available.");
  }
  appendLog(job, "system", `> ${trimmed}`);
}

export async function resetProjectWorkspace(projectId: string): Promise<{ workspacePath: string }> {
  const active = Array.from(jobs.values()).find(
    (run) =>
      run.projectId === projectId &&
      (run.status === "pending" || run.status === "running" || run.status === "stopping"),
  );

  if (active) {
    throw new Error("Cannot reset workspace while a run is active.");
  }

  const workspaceDir = getProjectWorkspacePath(projectId);
  await rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
  return { workspacePath: workspaceDir };
}

function getProjectWorkspacePath(projectId: string): string {
  const safeProject = projectId.replace(/[^a-zA-Z0-9-_]/g, "-");
  return join(WORKSPACE_ROOT, safeProject);
}

async function prepareWorkspace(job: RunJob, project: StoredProject): Promise<string> {
  await mkdir(WORKSPACE_ROOT, { recursive: true });
  const workspaceDir = getProjectWorkspacePath(project.id);
  await mkdir(workspaceDir, { recursive: true });

  const state = await loadWorkspaceState(project.id);
  const updatedState = await syncWorkspaceWithArtifact(workspaceDir, job, state);
  await saveWorkspaceState(project.id, updatedState);

  job.workspaceStatus = toWorkspaceStatus(updatedState);

  return workspaceDir;
}

async function loadWorkspaceState(projectId: string): Promise<WorkspaceState | undefined> {
  const workspaceDir = getProjectWorkspacePath(projectId);
  const statePath = join(workspaceDir, WORKSPACE_STATE_FILENAME);
  try {
    const raw = await readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw) as WorkspaceState;
    return {
      lastBuildId: parsed.lastBuildId,
      lastSyncedAt: parsed.lastSyncedAt,
      baselineHashes: parsed.baselineHashes ?? {},
      dirtyPaths: parsed.dirtyPaths ?? [],
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn(`Failed to read workspace state for ${projectId}`, error);
    }
    return undefined;
  }
}

async function saveWorkspaceState(projectId: string, state: WorkspaceState): Promise<void> {
  const workspaceDir = getProjectWorkspacePath(projectId);
  await mkdir(workspaceDir, { recursive: true });
  const statePath = join(workspaceDir, WORKSPACE_STATE_FILENAME);
  const payload = JSON.stringify(state, null, 2);
  await writeFile(statePath, payload, "utf-8");
}

async function syncWorkspaceWithArtifact(
  workspaceDir: string,
  job: RunJob,
  state: WorkspaceState | undefined,
): Promise<WorkspaceState> {
  const zip = new AdmZip(job.artifactPath);
  const entries = zip.getEntries();
  const baseline = { ...(state?.baselineHashes ?? {}) };
  const dirty = new Set(state?.dirtyPaths ?? []);
  const seenPaths = new Set<string>();
  const firstRun = !state;

  for (const entry of entries) {
    const relativePath = normalizeEntryPath(entry.entryName);
    if (!relativePath) {
      continue;
    }
    seenPaths.add(relativePath);

    if (entry.isDirectory) {
      const dirPath = join(workspaceDir, relativePath);
      await mkdir(dirPath, { recursive: true });
      continue;
    }

    const targetPath = join(workspaceDir, relativePath);
    await mkdir(dirname(targetPath), { recursive: true });

    const data = entry.getData();
    const artifactHash = hashBuffer(data);

    const currentHash = await hashFileIfExists(targetPath);
    const previousBaseline = baseline[relativePath];
    const matchesArtifact = currentHash === artifactHash;
    const artifactChanged = previousBaseline && previousBaseline !== artifactHash;
    let wroteFile = false;

    if (firstRun) {
      await writeFile(targetPath, data);
      wroteFile = true;
    } else if (!currentHash) {
      await writeFile(targetPath, data);
      wroteFile = true;
    } else if (!previousBaseline) {
      if (!matchesArtifact) {
        dirty.add(relativePath);
        appendLog(job, "system", `Workspace file ${relativePath} differs from artifact; leaving existing copy untouched.`);
      } else {
        baseline[relativePath] = artifactHash;
        dirty.delete(relativePath);
      }
    } else if (artifactChanged) {
      // Artifact has changed - update file even if workspace was modified
      await writeFile(targetPath, data);
      wroteFile = true;
      appendLog(job, "system", `Updating ${relativePath} from changed artifact (previous baseline: ${previousBaseline.substring(0, 16)}..., new: ${artifactHash.substring(0, 16)}...).`);
    } else if (currentHash === previousBaseline) {
      await writeFile(targetPath, data);
      wroteFile = true;
    } else if (matchesArtifact) {
      baseline[relativePath] = artifactHash;
      dirty.delete(relativePath);
    } else {
      dirty.add(relativePath);
      appendLog(job, "system", `Preserving local changes to ${relativePath}; artifact update skipped.`);
    }

    if (wroteFile) {
      baseline[relativePath] = artifactHash;
      dirty.delete(relativePath);
    }
  }

  for (const key of Object.keys(baseline)) {
    if (!seenPaths.has(key)) {
      const filePath = join(workspaceDir, key);
      try {
        await rm(filePath, { force: true });
        appendLog(job, "system", `Removed ${key} (no longer in artifact)`);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
          appendLog(
            job,
            "system",
            `Failed to remove ${key}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      delete baseline[key];
      dirty.delete(key);
    }
  }

  return {
    lastBuildId: job.buildId,
    lastSyncedAt: new Date().toISOString(),
    baselineHashes: baseline,
    dirtyPaths: Array.from(dirty).sort(),
  };
}

function toWorkspaceStatus(state: WorkspaceState): RunWorkspaceStatus {
  return {
    lastBuildId: state.lastBuildId,
    lastSyncedAt: state.lastSyncedAt,
    dirtyPaths: state.dirtyPaths,
  };
}

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

function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function hashFileIfExists(path: string): Promise<string | undefined> {
  try {
    const fileStats = await stat(path);
    if (!fileStats.isFile()) {
      return undefined;
    }
    const data = await readFile(path);
    return hashBuffer(data);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}


