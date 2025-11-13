import { createHash } from "crypto";
import { existsSync } from "fs";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { parse } from "yaml";
import type { StoredProject } from "../types/storage";
import { resolveProjectRoot } from "./projectFiles";
import { listUploadedConfigFiles } from "./configUploads";

interface ProfileFileEntry {
  template?: string;
  output?: string;
}

interface ProfileDocument {
  plugins?: Array<{ id: string; version?: string }>;
  configs?: {
    files?: ProfileFileEntry[];
  };
}

async function readYamlDocument(path: string): Promise<ProfileDocument | null> {
  try {
    const raw = await readFile(path, "utf-8");
    return (parse(raw) as ProfileDocument) ?? null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn(`Failed to read YAML file at ${path}`, error);
    }
    return null;
  }
}

function computeHashFromString(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function computeFileHash(path: string): Promise<string | undefined> {
  try {
    const buffer = await readFile(path);
    return createHash("sha256").update(buffer).digest("hex");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn(`Failed to hash file at ${path}`, error);
    }
    return undefined;
  }
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const identifier = key(item);
    if (!seen.has(identifier)) {
      seen.add(identifier);
      result.push(item);
    }
  }
  return result;
}

export interface ScannedAssets {
  plugins: Array<{ id: string; version: string; sha256: string }>;
  configs: Array<{ path: string; sha256: string; pluginId?: string; definitionId?: string }>;
}

export async function scanProjectAssets(project: StoredProject): Promise<ScannedAssets> {
  const root = resolveProjectRoot(project);
  const profile = await readYamlDocument(join(root, "profiles", "base.yml"));

  const overlayDir = join(root, "overlays");
  let overlayFiles: string[] = [];
  try {
    overlayFiles = (await readdir(overlayDir)).filter((file) => file.endsWith(".yml"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn(`Failed to read overlays directory ${overlayDir}`, error);
    }
  }

  const overlayDocs = await Promise.all(
    overlayFiles.map((file) => readYamlDocument(join(overlayDir, file))),
  );

  const docs = [profile, ...overlayDocs].filter(
    (doc): doc is ProfileDocument => doc !== null,
  );

  const pluginEntries = uniqueBy(
    docs.flatMap((doc) => doc.plugins ?? []),
    (plugin) => `${plugin.id}:${plugin.version ?? "latest"}`,
  );

  const configEntries = uniqueBy(
    docs.flatMap((doc) => doc.configs?.files ?? []),
    (entry) => `${entry.output ?? entry.template ?? ""}`,
  );

  const plugins = await Promise.all(
    pluginEntries.map(async (plugin) => {
      const version = plugin.version ?? "latest";
      const jarCandidates = [
        join(root, "plugins", `${plugin.id}-${version}.jar`),
        join(root, "plugins", `${plugin.id}.jar`),
      ];
      let hash: string | undefined;
      for (const candidate of jarCandidates) {
        if (existsSync(candidate)) {
          hash = await computeFileHash(candidate);
          if (hash) break;
        }
      }
      if (!hash) {
        hash = computeHashFromString(`${plugin.id}@${version}`);
      }
      return {
        id: plugin.id,
        version,
        sha256: hash,
      };
    }),
  );

  const mappingIndex = new Map<string, { pluginId: string; definitionId?: string }>();
  for (const plugin of project.plugins ?? []) {
    for (const mapping of plugin.configMappings ?? []) {
      const resolvedPath = mapping.path?.trim();
      if (resolvedPath) {
        mappingIndex.set(resolvedPath, { pluginId: plugin.id, definitionId: mapping.definitionId });
      }
    }
  }

  const configs = await Promise.all(
    configEntries.map(async (entry) => {
      const output = entry.output ?? "";
      const templatePath = entry.template ? join(root, "configs", entry.template) : undefined;
      const outputPath = output ? join(root, output) : undefined;

      let hash: string | undefined;
      if (outputPath) {
        hash = await computeFileHash(outputPath);
      }
      if (!hash && templatePath) {
        hash = await computeFileHash(templatePath);
      }
      if (!hash && output) {
        hash = computeHashFromString(output);
      }

      const mapped = output ? mappingIndex.get(output) : undefined;

      return {
        path: output || entry.template || "unknown",
        sha256: hash ?? computeHashFromString(JSON.stringify(entry)),
        pluginId: mapped?.pluginId,
        definitionId: mapped?.definitionId,
      };
    }),
  );

  const configMap = new Map<string, { path: string; sha256: string; pluginId?: string; definitionId?: string }>();
  for (const existing of project.configs ?? []) {
    configMap.set(existing.path, {
      path: existing.path,
      sha256: existing.sha256 ?? "<pending>",
      pluginId: existing.pluginId,
      definitionId: existing.definitionId,
    });
  }
  for (const config of configs) {
    configMap.set(config.path, config);
  }

  const uploadedSummaries = await listUploadedConfigFiles(project);
  for (const summary of uploadedSummaries) {
    const previous = configMap.get(summary.path);
    const sha256 = summary.sha256 ?? previous?.sha256 ?? computeHashFromString(summary.path);
    configMap.set(summary.path, {
      path: summary.path,
      sha256,
      pluginId: previous?.pluginId ?? summary.pluginId,
      definitionId: previous?.definitionId ?? summary.definitionId,
    });
  }

  const mergedConfigs = Array.from(configMap.values()).sort((a, b) => a.path.localeCompare(b.path));

  return {
    plugins,
    configs: mergedConfigs,
  };
}

