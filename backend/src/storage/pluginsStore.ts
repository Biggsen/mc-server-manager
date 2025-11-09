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

export async function findStoredPlugin(
  id: string,
  version: string,
): Promise<StoredPluginRecord | undefined> {
  const snapshot = await loadSnapshot();
  const key = keyFor({ id, version });
  return snapshot.plugins.find((plugin) => keyFor(plugin) === key);
}

type StoredPluginInput = Omit<StoredPluginRecord, "createdAt" | "updatedAt"> &
  Partial<Pick<StoredPluginRecord, "createdAt" | "updatedAt">>;

export async function upsertStoredPlugin(record: StoredPluginInput): Promise<StoredPluginRecord> {
  const snapshot = await loadSnapshot();
  const now = new Date().toISOString();
  const normalizedId = record.id.trim();
  const normalizedVersion = record.version.trim();
  const targetKey = keyFor({ id: normalizedId, version: normalizedVersion });
  const existingIndex = snapshot.plugins.findIndex((plugin) => keyFor(plugin) === targetKey);

  const shouldUpdateCache = !!record.cachePath?.length;
  const cachedAt =
    shouldUpdateCache && record.cachedAt !== undefined ? record.cachedAt : shouldUpdateCache ? now : undefined;
  const lastUsedAt =
    record.lastUsedAt ??
    (shouldUpdateCache ? now : undefined);

  if (existingIndex >= 0) {
    const existing = snapshot.plugins[existingIndex];
    snapshot.plugins[existingIndex] = {
      ...existing,
      ...record,
      id: normalizedId,
      version: normalizedVersion,
      createdAt: existing.createdAt,
      updatedAt: now,
      cachePath: record.cachePath ?? existing.cachePath,
      artifactFileName: record.artifactFileName ?? existing.artifactFileName,
      cachedAt: cachedAt ?? existing.cachedAt,
      lastUsedAt: lastUsedAt ?? existing.lastUsedAt,
      sha256: record.sha256 ?? existing.sha256,
      minecraftVersionMin: record.minecraftVersionMin ?? existing.minecraftVersionMin,
      minecraftVersionMax: record.minecraftVersionMax ?? existing.minecraftVersionMax,
      provider: record.provider ?? existing.provider,
      source: record.source ?? existing.source,
    };
  } else {
    const created: StoredPluginRecord = {
      id: normalizedId,
      version: normalizedVersion,
      provider: record.provider,
      source: record.source,
      sha256: record.sha256,
      minecraftVersionMin: record.minecraftVersionMin,
      minecraftVersionMax: record.minecraftVersionMax,
      cachePath: record.cachePath,
      artifactFileName: record.artifactFileName,
      cachedAt,
      lastUsedAt,
      createdAt: record.createdAt ?? now,
      updatedAt: now,
    };
    snapshot.plugins.push(created);
  }

  snapshot.plugins.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  await persistSnapshot(snapshot);
  return snapshot.plugins.find((plugin) => keyFor(plugin) === targetKey) as StoredPluginRecord;
}


