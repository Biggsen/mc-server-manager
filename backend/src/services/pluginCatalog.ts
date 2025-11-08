export interface PluginSearchResult {
  provider: "hangar" | "modrinth" | "spiget";
  id: string;
  slug: string;
  name: string;
  summary?: string;
  projectUrl?: string;
}

export interface PluginVersionResult {
  versionId: string;
  name: string;
  downloadUrl?: string;
  releasedAt?: string;
  supports: Array<{ loader: string; minecraftVersions: string[] }>;
}

const USER_AGENT = "mc-server-manager";
const MAX_RESULT_AGE_DAYS = 365;

function withinCutoff(isoDate?: string): boolean {
  if (!isoDate) return true;
  const timestamp = Date.parse(isoDate);
  if (Number.isNaN(timestamp)) return true;
  const cutoff = Date.now() - MAX_RESULT_AGE_DAYS * 24 * 60 * 60 * 1000;
  return timestamp >= cutoff;
}

export async function searchPlugins(
  query: string,
  loader: string,
  minecraftVersion: string,
): Promise<PluginSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const results = await Promise.allSettled([
    searchHangar(trimmed, loader, minecraftVersion),
    searchModrinth(trimmed, loader, minecraftVersion),
    searchSpiget(trimmed),
  ]);

  const merged: PluginSearchResult[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      merged.push(...result.value);
    }
  }

  const seen = new Set<string>();
  return merged
    .filter((item) => {
      const key = `${item.provider}:${item.slug}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export async function fetchPluginVersions(
  provider: "hangar" | "modrinth" | "spiget",
  slug: string,
  loader: string,
  minecraftVersion: string,
): Promise<PluginVersionResult[]> {
  switch (provider) {
    case "hangar":
      return fetchHangarVersions(slug);
    case "modrinth":
      return fetchModrinthVersions(slug, loader, minecraftVersion);
    case "spiget":
      return fetchSpigetVersions(slug);
    default:
      return [];
  }
}

const HANGAR_API = "https://hangar.papermc.io/api/v1";

async function searchHangar(
  query: string,
  loader: string,
  minecraftVersion: string,
): Promise<PluginSearchResult[]> {
  const response = await fetch(
    `${HANGAR_API}/projects?limit=25&offset=0&query=${encodeURIComponent(query)}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    },
  );

  if (!response.ok) {
    console.warn("Hangar search failed:", response.statusText);
    return [];
  }

  const payload = (await response.json()) as {
    result?: Array<{
      name: string;
      slug: string;
      description?: string;
      urls?: { project: string };
    }>;
  };

  const projects = payload.result ?? [];
  const filtered: PluginSearchResult[] = [];

  for (const project of projects) {
    const versions = await fetchHangarVersions(project.slug);
    const compatible = versions.find((version) =>
      version.supports.some(
        (support) =>
          support.loader.toLowerCase() === loader.toLowerCase() &&
          support.minecraftVersions.includes(minecraftVersion),
      ),
    );

    if (!compatible && versions.length > 0 && !withinCutoff(versions[0].releasedAt)) {
      continue;
    }

    filtered.push({
      provider: "hangar" as const,
      id: project.slug,
      slug: project.slug,
      name: project.name,
      summary: project.description,
      projectUrl: project.urls?.project,
    });
  }

  return filtered;
}

async function fetchHangarVersions(slug: string): Promise<PluginVersionResult[]> {
  const response = await fetch(
    `${HANGAR_API}/projects/${encodeURIComponent(slug)}/versions?limit=50`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    },
  );

  if (!response.ok) {
    console.warn("Hangar versions failed:", response.statusText);
    return [];
  }

  const payload = (await response.json()) as {
    result?: Array<{
      id: number;
      name: string;
      createdAt?: string;
      downloads?: Record<string, string>;
      platformDependencies?: Array<{
        platform: string;
        versions: string[];
      }>;
    }>;
  };

  return (payload.result ?? []).map((version) => ({
    versionId: String(version.id),
    name: version.name,
    releasedAt: version.createdAt,
    downloadUrl: version.downloads?.PAPER ?? version.downloads?.["HANGAR_DOWNLOAD"],
    supports:
      version.platformDependencies?.map((dep) => ({
        loader: dep.platform,
        minecraftVersions: dep.versions,
      })) ?? [],
  }));
}

async function searchModrinth(
  query: string,
  loader: string,
  minecraftVersion: string,
): Promise<PluginSearchResult[]> {
  const facets = [
    `["project_type:mod"]`,
    `["servers:true"]`,
    `["versions:${minecraftVersion}"]`,
    `["categories:${loader.toLowerCase()}"]`,
  ];
  const response = await fetch(
    `https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&limit=25&facets=[${facets.join(
      ",",
    )}]`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    },
  );

  if (!response.ok) {
    console.warn("Modrinth search failed:", response.statusText);
    return [];
  }

  const payload = (await response.json()) as {
    hits?: Array<{
      project_id: string;
      slug: string;
      title: string;
      description?: string;
      project_url: string;
    }>;
  };

  return (payload.hits ?? []).map((hit) => ({
    provider: "modrinth" as const,
    id: hit.project_id,
    slug: hit.project_id,
    name: hit.title,
    summary: hit.description,
    projectUrl: hit.project_url,
  }));
}

async function fetchModrinthVersions(
  projectId: string,
  loader: string,
  minecraftVersion: string,
): Promise<PluginVersionResult[]> {
  const response = await fetch(`https://api.modrinth.com/v2/project/${projectId}/version`, {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    console.warn("Modrinth versions failed:", response.statusText);
    return [];
  }

  const versions = (await response.json()) as Array<{
    id: string;
    version_number: string;
    files: Array<{ filename: string; url: string }>;
    date_published?: string;
    loaders?: string[];
    game_versions?: string[];
  }>;

  return versions
    .filter((version) => {
      const loaderMatches = version.loaders?.length
        ? version.loaders.some((entry) => entry.toLowerCase() === loader.toLowerCase())
        : true;
      const mcMatches = version.game_versions?.length
        ? version.game_versions.includes(minecraftVersion)
        : true;
      return loaderMatches && mcMatches && withinCutoff(version.date_published);
    })
    .map((version) => ({
      versionId: version.id,
      name: version.version_number,
      downloadUrl: version.files?.[0]?.url,
      releasedAt: version.date_published,
      supports: [
        {
          loader,
          minecraftVersions: version.game_versions ?? [],
        },
      ],
    }));
}

async function searchSpiget(query: string): Promise<PluginSearchResult[]> {
  const response = await fetch(
    `https://api.spiget.org/v2/search/resources/${encodeURIComponent(query)}?size=25`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    },
  );

  if (!response.ok) {
    console.warn("Spiget search failed:", response.statusText);
    return [];
  }

  const payload = (await response.json()) as Array<{ id: number; name: string; tag?: string }>;
  return payload.map((resource) => ({
    provider: "spiget" as const,
    id: String(resource.id),
    slug: String(resource.id),
    name: resource.name,
    summary: resource.tag,
    projectUrl: `https://www.spigotmc.org/resources/${resource.id}`,
  }));
}

async function fetchSpigetVersions(resourceId: string): Promise<PluginVersionResult[]> {
  const response = await fetch(
    `https://api.spiget.org/v2/resources/${resourceId}/versions?size=30`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    },
  );

  if (!response.ok) {
    console.warn("Spiget versions failed:", response.statusText);
    return [];
  }

  const versions = (await response.json()) as Array<{
    id: number;
    name: string;
    releaseDate?: number;
  }>;

  return versions.map((version) => ({
    versionId: String(version.id),
    name: version.name,
    downloadUrl: `https://api.spiget.org/v2/resources/${resourceId}/download/${version.id}.jar`,
    releasedAt: version.releaseDate
      ? new Date(version.releaseDate * 1000).toISOString()
      : undefined,
    supports: [],
  }));
}

