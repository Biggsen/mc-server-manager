import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { StoredPluginRecord } from "../types/plugins";
import { getDataRoot } from "../config";

// Helper functions to compute paths at runtime (not at module load)
function getDataDir(): string {
  return getDataRoot();
}

function getPluginsPath(): string {
  return join(getDataDir(), "data", "plugins.json");
}

interface PluginsSnapshot {
  plugins: StoredPluginRecord[];
}

async function ensureStore(): Promise<void> {
  const dataDir = getDataDir();
  const pluginsPath = getPluginsPath();

  await mkdir(dataDir, { recursive: true });

  try {
    await readFile(pluginsPath, "utf-8");
    // File exists, no action needed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // File doesn't exist - create empty file
      const empty: PluginsSnapshot = { plugins: [] };
      await writeFile(pluginsPath, JSON.stringify(empty, null, 2), "utf-8");
      return;
    }
    throw error;
  }
}

async function loadSnapshot(): Promise<PluginsSnapshot> {
  await ensureStore();
  const pluginsPath = getPluginsPath();
  const contents = await readFile(pluginsPath, "utf-8");
  const snapshot = JSON.parse(contents) as PluginsSnapshot;
  return snapshot;
}

async function persistSnapshot(snapshot: PluginsSnapshot): Promise<void> {
  await ensureStore();
  const pluginsPath = getPluginsPath();
  await writeFile(pluginsPath, JSON.stringify(snapshot, null, 2), "utf-8");
}

function keyFor(record: Pick<StoredPluginRecord, "id" | "version">): string {
  return `${record.id.toLowerCase()}:${record.version.toLowerCase()}`;
}

export async function listStoredPlugins(): Promise<StoredPluginRecord[]> {
  const snapshot = await loadSnapshot();
  return snapshot.plugins.slice().sort((a, b) => {
    const idCompare = a.id.localeCompare(b.id, undefined, { sensitivity: 'base' });
    if (idCompare !== 0) return idCompare;
    // If IDs are the same, sort by version (newest first)
    return b.version.localeCompare(a.version, undefined, { numeric: true, sensitivity: 'base' });
  });
}

export async function deleteStoredPlugin(id: string, version: string): Promise<boolean> {
  const snapshot = await loadSnapshot();
  const key = keyFor({ id, version });
  const index = snapshot.plugins.findIndex((plugin) => keyFor(plugin) === key);
  if (index === -1) {
    return false;
  }
  snapshot.plugins.splice(index, 1);
  await persistSnapshot(snapshot);
  return true;
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
      configDefinitions: record.configDefinitions ?? existing.configDefinitions,
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
      configDefinitions: record.configDefinitions ? [...record.configDefinitions] : undefined,
    };
    snapshot.plugins.push(created);
  }

  snapshot.plugins.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  await persistSnapshot(snapshot);
  return snapshot.plugins.find((plugin) => keyFor(plugin) === targetKey) as StoredPluginRecord;
}


