import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { StoredPluginRecord } from "../types/plugins";

const DATA_DIR = join(process.cwd(), "data");
const PLUGINS_PATH = join(DATA_DIR, "plugins.json");

interface PluginsSnapshot {
  plugins: StoredPluginRecord[];
}

async function ensureStore(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });

  try {
    await readFile(PLUGINS_PATH, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const empty: PluginsSnapshot = { plugins: [] };
      await writeFile(PLUGINS_PATH, JSON.stringify(empty, null, 2), "utf-8");
      return;
    }
    throw error;
  }
}

async function loadSnapshot(): Promise<PluginsSnapshot> {
  await ensureStore();
  const contents = await readFile(PLUGINS_PATH, "utf-8");
  return JSON.parse(contents) as PluginsSnapshot;
}

async function persistSnapshot(snapshot: PluginsSnapshot): Promise<void> {
  await ensureStore();
  await writeFile(PLUGINS_PATH, JSON.stringify(snapshot, null, 2), "utf-8");
}

function keyFor(record: Pick<StoredPluginRecord, "id" | "version">): string {
  return `${record.id.toLowerCase()}:${record.version.toLowerCase()}`;
}

export async function listStoredPlugins(): Promise<StoredPluginRecord[]> {
  const snapshot = await loadSnapshot();
  return snapshot.plugins.slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

type StoredPluginInput = Omit<StoredPluginRecord, "createdAt" | "updatedAt"> &
  Partial<Pick<StoredPluginRecord, "createdAt" | "updatedAt">>;

export async function upsertStoredPlugin(record: StoredPluginInput): Promise<StoredPluginRecord> {
  const snapshot = await loadSnapshot();
  const now = new Date().toISOString();
  const normalizedId = record.id.trim();
  const normalizedVersion = record.version.trim();
  const newRecord: StoredPluginRecord = {
    ...record,
    id: normalizedId,
    version: normalizedVersion,
    createdAt: record.createdAt ?? now,
    updatedAt: now,
  };

  const targetKey = keyFor(newRecord);
  const existingIndex = snapshot.plugins.findIndex(
    (plugin) => keyFor(plugin) === targetKey,
  );
  if (existingIndex >= 0) {
    const existing = snapshot.plugins[existingIndex];
    snapshot.plugins[existingIndex] = {
      ...existing,
      ...newRecord,
      createdAt: existing.createdAt,
      updatedAt: now,
    };
  } else {
    snapshot.plugins.push(newRecord);
  }

  snapshot.plugins.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  await persistSnapshot(snapshot);
  return newRecord;
}


