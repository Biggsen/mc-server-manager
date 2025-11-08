import type { Request, Response } from "express";
import { Router } from "express";
import { fetchPluginVersions, searchPlugins } from "../services/pluginCatalog";

const router = Router();

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

    const searchTerm = rawQuery.trim();
    if (!searchTerm) {
      res.json({ results: [] });
      return;
    }

    const results = await searchPlugins(searchTerm, loader, minecraftVersion);
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

