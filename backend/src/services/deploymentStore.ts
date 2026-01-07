import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { v4 as uuid } from "uuid";
import type {
  DeploymentSnapshot,
  DeploymentTarget,
  DeploymentType,
  FolderDeploymentTarget,
  SftpDeploymentTarget,
} from "../types/deployment";
import { getDataRoot } from "../config";

const DATA_DIR = getDataRoot();
const DEPLOYMENTS_PATH = join(DATA_DIR, "deployments.json");

async function ensureStore(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    await readFile(DEPLOYMENTS_PATH, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const empty: DeploymentSnapshot = { targets: [] };
      await writeFile(DEPLOYMENTS_PATH, JSON.stringify(empty, null, 2), "utf-8");
      return;
    }
    throw error;
  }
}

async function loadSnapshot(): Promise<DeploymentSnapshot> {
  await ensureStore();
  const contents = await readFile(DEPLOYMENTS_PATH, "utf-8");
  return JSON.parse(contents) as DeploymentSnapshot;
}

async function persistSnapshot(snapshot: DeploymentSnapshot): Promise<void> {
  await ensureStore();
  await writeFile(DEPLOYMENTS_PATH, JSON.stringify(snapshot, null, 2), "utf-8");
}

export async function listDeploymentTargets(): Promise<DeploymentTarget[]> {
  const snapshot = await loadSnapshot();
  return snapshot.targets;
}

interface CreateDeploymentTargetInput {
  name: string;
  type: DeploymentType;
  notes?: string;
  folder?: {
    path: string;
  };
  sftp?: {
    host: string;
    port?: number;
    username: string;
    remotePath: string;
  };
}

export async function createDeploymentTarget(
  input: CreateDeploymentTargetInput,
): Promise<DeploymentTarget> {
  const snapshot = await loadSnapshot();
  const now = new Date().toISOString();
  const id = uuid();

  let target: DeploymentTarget;
  if (input.type === "folder") {
    const config = input.folder;
    if (!config?.path) {
      throw new Error("Folder deployment requires a path.");
    }
    target = {
      id,
      name: input.name,
      type: "folder",
      path: config.path,
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
    } satisfies FolderDeploymentTarget;
  } else {
    const config = input.sftp;
    if (!config?.host || !config.username || !config.remotePath) {
      throw new Error("SFTP deployment requires host, username, and remotePath.");
    }
    target = {
      id,
      name: input.name,
      type: "sftp",
      host: config.host,
      port: config.port ?? 22,
      username: config.username,
      remotePath: config.remotePath,
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
    } satisfies SftpDeploymentTarget;
  }

  snapshot.targets = snapshot.targets.filter((existing) => existing.id !== id);
  snapshot.targets.push(target);
  snapshot.targets.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  await persistSnapshot(snapshot);
  return target;
}

export async function findDeploymentTarget(id: string): Promise<DeploymentTarget | undefined> {
  const snapshot = await loadSnapshot();
  return snapshot.targets.find((target) => target.id === id);
}


