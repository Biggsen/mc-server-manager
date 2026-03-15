import { mkdir, readFile, writeFile, rm } from "fs/promises";
import { join } from "path";
import type { DeploymentRecord } from "../types/deployment";
import { getDataRoot } from "../config";

const DATA_DIR = getDataRoot();
const RECORDS_PATH = join(DATA_DIR, "data", "deployment-records.json");

interface RecordsSnapshot {
  records: DeploymentRecord[];
}

async function ensureStore(): Promise<void> {
  await mkdir(join(DATA_DIR, "data"), { recursive: true });
  try {
    await readFile(RECORDS_PATH, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const empty: RecordsSnapshot = { records: [] };
      await writeFile(RECORDS_PATH, JSON.stringify(empty, null, 2), "utf-8");
      return;
    }
    throw error;
  }
}

async function loadSnapshot(): Promise<RecordsSnapshot> {
  await ensureStore();
  const contents = await readFile(RECORDS_PATH, "utf-8");
  return JSON.parse(contents) as RecordsSnapshot;
}

async function persistSnapshot(snapshot: RecordsSnapshot): Promise<void> {
  await ensureStore();
  await writeFile(RECORDS_PATH, JSON.stringify(snapshot, null, 2), "utf-8");
}

export async function listDeploymentRecords(projectId?: string): Promise<DeploymentRecord[]> {
  const snapshot = await loadSnapshot();
  let list = snapshot.records;
  if (projectId) {
    list = list.filter((r) => r.projectId === projectId);
  }
  return list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

const PAD_LENGTH = 3;

export function getShortDeploymentId(fullId: string): string {
  return fullId.includes(":") ? fullId.split(":")[1]! : fullId;
}

export async function getNextDeploymentId(projectId: string): Promise<string> {
  const snapshot = await loadSnapshot();
  const projectRecords = snapshot.records.filter((r) => r.projectId === projectId);
  const numbers = projectRecords
    .map((r) => getShortDeploymentId(r.id))
    .filter((short) => /^\d+$/.test(short))
    .map((short) => parseInt(short, 10));
  const max = numbers.length > 0 ? Math.max(...numbers) : 0;
  return String(max + 1).padStart(PAD_LENGTH, "0");
}

export async function findDeploymentRecord(id: string): Promise<DeploymentRecord | undefined> {
  const snapshot = await loadSnapshot();
  return snapshot.records.find((r) => r.id === id);
}

export async function appendDeploymentRecord(
  record: Omit<DeploymentRecord, "id">,
  id?: string,
): Promise<DeploymentRecord> {
  const snapshot = await loadSnapshot();
  if (id == null) {
    throw new Error("Deployment id is required (use getNextDeploymentId).");
  }
  const full: DeploymentRecord = {
    ...record,
    id,
  };
  snapshot.records.push(full);
  snapshot.records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  await persistSnapshot(snapshot);
  return full;
}

export async function deleteDeploymentRecord(id: string): Promise<boolean> {
  const snapshot = await loadSnapshot();
  const index = snapshot.records.findIndex((r) => r.id === id);
  if (index === -1) {
    return false;
  }
  const record = snapshot.records[index]!;
  snapshot.records.splice(index, 1);
  await persistSnapshot(snapshot);
  if (record.artifactPath) {
    await rm(record.artifactPath, { force: true }).catch(() => {});
  }
  return true;
}
