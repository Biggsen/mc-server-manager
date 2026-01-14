import type { Request, Response } from "express";
import { Router } from "express";
import { createHash } from "crypto";
import multer from "multer";
import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { join, relative } from "path";
import { fetchPluginVersions, searchPlugins } from "../services/pluginCatalog";
import {
  deleteStoredPlugin,
  findStoredPlugin,
  listStoredPlugins,
  upsertStoredPlugin,
} from "../storage/pluginsStore";
import type {
  PluginConfigDefinition,
  PluginProvider,
  PluginSourceReference,
} from "../types/plugins";

const router = Router();

const pluginUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 64 * 1024 * 1024,
  },
});

import { getCacheRoot } from "../config";
const CACHE_ROOT = join(getCacheRoot(), "plugins");

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function getCacheDir(pluginId: string, version: string): string {
  return join(CACHE_ROOT, pluginId, version);
}

function toRelativeCachePath(absolutePath: string): string {
  return toPosixPath(relative(CACHE_ROOT, absolutePath));
}

function toPosixPath(pathString: string): string {
  return pathString.replace(/\\/g, "/");
}

function normalizeConfigPath(input: unknown): string {
  if (typeof input !== "string") {
    throw new Error("config path must be a string");
  }
  let normalized = input.replace(/\\/g, "/").trim();
  if (normalized.startsWith("/")) {
    normalized = normalized.slice(1);
  }
  if (!normalized) {
    throw new Error("config path cannot be empty");
  }
  if (normalized.includes("..")) {
    throw new Error("config path cannot contain traversal segments");
  }
  return normalized;
}

function slugifyConfigId(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseConfigDefinitions(input: unknown): PluginConfigDefinition[] | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }
  const raw =
    typeof input === "string"
      ? (() => {
          try {
            return JSON.parse(input) as unknown;
          } catch (error) {
            throw new Error("configDefinitions must be valid JSON");
          }
        })()
      : input;
  if (!Array.isArray(raw)) {
    throw new Error("configDefinitions must be an array");
  }
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  const normalized: PluginConfigDefinition[] = raw.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`configDefinitions[${index}] must be an object`);
    }
    const candidateId =
      typeof (entry as { id?: unknown }).id === "string"
        ? slugifyConfigId((entry as { id: string }).id)
        : "";
    const candidateLabel =
      typeof (entry as { label?: unknown }).label === "string" ? (entry as { label: string }).label : "";
    const path = normalizeConfigPath((entry as { path?: unknown }).path);
    const id = candidateId || slugifyConfigId(candidateLabel) || slugifyConfigId(path);
    if (!id) {
      throw new Error(`configDefinitions[${index}] is missing a valid id`);
    }
    if (seenIds.has(id)) {
      throw new Error(`Duplicate config definition id "${id}"`);
    }
    if (seenPaths.has(path)) {
      throw new Error(`Duplicate config path "${path}"`);
    }
    seenIds.add(id);
    seenPaths.add(path);

    // Requirement field is ignored (for backward compatibility during migration)
    // Simply don't parse requirement field

    let tags: string[] | undefined;
    const incomingTags = (entry as { tags?: unknown }).tags;
    if (incomingTags !== undefined) {
      if (!Array.isArray(incomingTags) || incomingTags.some((tag) => typeof tag !== "string")) {
        throw new Error(`configDefinitions[${index}].tags must be an array of strings`);
      }
      tags = incomingTags.map((tag) => tag.trim()).filter((tag) => tag.length > 0);
    }

    const description =
      typeof (entry as { description?: unknown }).description === "string"
        ? (entry as { description: string }).description
        : undefined;

    return {
      id,
      path,
      label: candidateLabel?.trim() ? candidateLabel.trim() : undefined,
      description: description?.trim() ? description.trim() : undefined,
      tags,
    };
  });
  return normalized;
}

async function ensurePluginCache(
  pluginId: string,
  version: string,
  fileName: string,
  buffer: Buffer,
): Promise<{ cachePath: string }> {
  const cacheDir = getCacheDir(pluginId, version);
  const absolutePath = join(cacheDir, fileName);
  await mkdir(cacheDir, { recursive: true });
  if (!existsSync(absolutePath)) {
    await writeFile(absolutePath, buffer);
  }
  return { cachePath: toRelativeCachePath(absolutePath) };
}

router.get("/library", async (_req: Request, res: Response) => {
  try {
    const plugins = await listStoredPlugins();
    res.json({ plugins });
  } catch (error) {
    console.error("Failed to load stored plugins", error);
    res.status(500).json({ error: "Failed to load stored plugins" });
  }
});

router.post("/library", async (req: Request, res: Response) => {
  try {
    const {
      pluginId,
      version,
      provider,
      source,
      downloadUrl,
      hash,
      minecraftVersionMin,
      minecraftVersionMax,
      cachePath,
      configDefinitions: rawConfigDefinitions,
    } = req.body ?? {};

    if (!pluginId || !version) {
      res.status(400).json({ error: "pluginId and version are required" });
      return;
    }

    let providerValue: PluginProvider | undefined;
    if (provider) {
      const normalized = String(provider).toLowerCase();
      const supported: PluginProvider[] = ["hangar", "modrinth", "spiget", "github", "custom"];
      if (!supported.includes(normalized as PluginProvider)) {
        res.status(400).json({ error: `Provider "${provider}" is not supported` });
        return;
      }
      providerValue = normalized as PluginProvider;
    }

    const coerceVersion = (value: unknown): string | undefined =>
      typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

    const normalizedMin = coerceVersion(minecraftVersionMin);
    const normalizedMax = coerceVersion(minecraftVersionMax);
    const sourceMin =
      coerceVersion(source?.minecraftVersionMin) ?? coerceVersion(source?.minecraftVersion);
    const sourceMax =
      coerceVersion(source?.minecraftVersionMax) ?? coerceVersion(source?.minecraftVersion);

    const finalMin = normalizedMin ?? sourceMin;
    const finalMax = normalizedMax ?? sourceMax;

    const resolvedProvider: PluginProvider | undefined =
      providerValue ?? (downloadUrl ? "custom" : undefined);

    if (!finalMin || !finalMax) {
      res.status(400).json({
        error: "Minecraft version range (minecraftVersionMin and minecraftVersionMax) is required",
      });
      return;
    }

    const sourceRef: PluginSourceReference | undefined =
      source || downloadUrl
        ? {
            provider: resolvedProvider ?? "custom",
            slug: typeof source?.slug === "string" ? source.slug : pluginId,
            displayName: source?.displayName,
            projectUrl: source?.projectUrl,
            versionId: source?.versionId,
            downloadUrl: downloadUrl ?? source?.downloadUrl,
            loader: source?.loader,
            minecraftVersion: source?.minecraftVersion,
            minecraftVersionMin: finalMin,
            minecraftVersionMax: finalMax,
            sha256: hash ?? source?.sha256,
            cachePath: cachePath ?? source?.cachePath,
          }
        : source
        ? {
            provider: providerValue ?? source.provider,
            slug: typeof source.slug === "string" ? source.slug : pluginId,
            displayName: source.displayName,
            projectUrl: source.projectUrl,
            versionId: source.versionId,
            downloadUrl: source.downloadUrl,
            loader: source.loader,
            minecraftVersion: source.minecraftVersion,
            minecraftVersionMin: source.minecraftVersionMin ?? finalMin,
            minecraftVersionMax: source.minecraftVersionMax ?? finalMax,
            sha256: source.sha256,
            cachePath: source.cachePath ?? cachePath,
          }
        : undefined;

    let configDefinitions: PluginConfigDefinition[] | undefined;
    try {
      configDefinitions = parseConfigDefinitions(rawConfigDefinitions);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid configDefinitions" });
      return;
    }

    const stored = await upsertStoredPlugin({
      id: pluginId,
      version,
      provider: sourceRef?.provider ?? resolvedProvider ?? providerValue,
      sha256: hash ?? sourceRef?.sha256,
      minecraftVersionMin: sourceRef?.minecraftVersionMin ?? finalMin,
      minecraftVersionMax: sourceRef?.minecraftVersionMax ?? finalMax,
      source: sourceRef,
      cachePath: cachePath ?? sourceRef?.cachePath,
      configDefinitions,
    });

    const plugins = await listStoredPlugins();
    res.status(200).json({ plugin: stored, plugins });
  } catch (error) {
    console.error("Failed to add plugin to library", error);
    res.status(500).json({ error: "Failed to add plugin to library" });
  }
});

router.post(
  "/library/upload",
  pluginUpload.single("file"),
  async (req: Request, res: Response) => {
    try {
      const file = req.file;
      const {
        pluginId,
        version,
        minecraftVersionMin,
        minecraftVersionMax,
        configDefinitions: rawConfigDefinitions,
      } = req.body ?? {};

      if (!file) {
        res.status(400).json({ error: "Plugin file is required" });
        return;
      }
      if (!pluginId || !version) {
        res.status(400).json({ error: "pluginId and version are required" });
        return;
      }

      const coerceVersion = (value: unknown): string | undefined =>
        typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
      const normalizedMin = coerceVersion(minecraftVersionMin);
      const normalizedMax = coerceVersion(minecraftVersionMax);

      if (!normalizedMin || !normalizedMax) {
        res.status(400).json({
          error: "minecraftVersionMin and minecraftVersionMax are required",
        });
        return;
      }

      const safeName = sanitizeFileName(file.originalname || `${pluginId}-${version}.jar`);
      const sha256 = createHash("sha256").update(file.buffer).digest("hex");
      const { cachePath } = await ensurePluginCache(pluginId, version, safeName, file.buffer);

      let configDefinitions: PluginConfigDefinition[] | undefined;
      try {
        configDefinitions = parseConfigDefinitions(rawConfigDefinitions);
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : "Invalid configDefinitions" });
        return;
      }

      const stored = await upsertStoredPlugin({
        id: pluginId,
        version,
        provider: "custom",
        sha256,
        minecraftVersionMin: normalizedMin,
        minecraftVersionMax: normalizedMax,
        source: {
          provider: "custom",
          slug: pluginId,
          uploadPath: cachePath,
          sha256,
          minecraftVersionMin: normalizedMin,
          minecraftVersionMax: normalizedMax,
          cachePath,
        },
        cachePath,
        configDefinitions,
      });

      const plugins = await listStoredPlugins();
      res.status(201).json({ plugin: stored, plugins });
    } catch (error) {
      console.error("Failed to upload plugin to library", error);
      res.status(500).json({ error: "Failed to upload plugin to library" });
    }
  },
);

router.delete("/library/:id/:version", async (req: Request, res: Response) => {
  try {
    const { id, version } = req.params;
    if (!id || !version) {
      res.status(400).json({ error: "Plugin id and version are required" });
      return;
    }

    const removed = await deleteStoredPlugin(id, version);
    if (!removed) {
      res.status(404).json({ error: "Plugin not found in library" });
      return;
    }

    const plugins = await listStoredPlugins();
    res.json({ plugins });
  } catch (error) {
    console.error("Failed to delete stored plugin", error);
    res.status(500).json({ error: "Failed to delete stored plugin" });
  }
});

router.put("/library/:id/:version/configs", async (req: Request, res: Response) => {
  try {
    const { id, version } = req.params;
    if (!id || !version) {
      res.status(400).json({ error: "Plugin id and version are required" });
      return;
    }

    const existing = await findStoredPlugin(id, version);
    if (!existing) {
      res.status(404).json({ error: "Plugin not found in library" });
      return;
    }

    let configDefinitions: PluginConfigDefinition[] | undefined;
    try {
      configDefinitions = parseConfigDefinitions(req.body?.configDefinitions ?? []);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid configDefinitions" });
      return;
    }

    const updated = await upsertStoredPlugin({
      ...existing,
      configDefinitions,
    });

    res.json({ plugin: updated });
  } catch (error) {
    console.error("Failed to update plugin config definitions", error);
    res.status(500).json({ error: "Failed to update plugin config definitions" });
  }
});

router.get("/search", async (req: Request, res: Response) => {
  try {
    const rawQuery =
      typeof req.query.query === "string"
        ? req.query.query
        : typeof req.query.q === "string"
        ? req.query.q
        : "";
    const loader = typeof req.query.loader === "string" ? req.query.loader : "paper";
    const minecraftVersion =
      typeof req.query.minecraftVersion === "string" ? req.query.minecraftVersion : "latest";
    const allowFallback = req.query.fallback === "1";

    const searchTerm = rawQuery.trim();
    if (!searchTerm) {
      res.json({ results: [] });
      return;
    }

    let results = await searchPlugins(searchTerm, loader, minecraftVersion, false);
    if (results.length === 0 && allowFallback) {
      results = await searchPlugins(searchTerm, loader, minecraftVersion, true);
    }
    res.json({ results });
  } catch (error) {
    console.error("Plugin search failed", error);
    res.status(500).json({ error: "Plugin search failed" });
  }
});

router.get("/:provider/:slug/versions", async (req: Request, res: Response) => {
  try {
    const { provider, slug } = req.params;
    const loader = typeof req.query.loader === "string" ? req.query.loader : "paper";
    const minecraftVersion =
      typeof req.query.minecraftVersion === "string" ? req.query.minecraftVersion : "latest";

    if (!provider || !slug) {
      res.status(400).json({ error: "provider and slug are required" });
      return;
    }

    const versions = await fetchPluginVersions(
      provider as "hangar" | "modrinth" | "spiget",
      slug,
      loader,
      minecraftVersion,
    );
    res.json({ provider, versions });
  } catch (error) {
    console.error("Plugin version lookup failed", error);
    res.status(500).json({ error: "Plugin version lookup failed" });
  }
});

export default router;

