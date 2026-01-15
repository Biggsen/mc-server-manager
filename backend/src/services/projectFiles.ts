import { existsSync, readdirSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import Handlebars from "handlebars";
import { parse, stringify } from "yaml";
import type { StoredProject } from "../types/storage";
import { getProjectsRoot, getTemplatesRoot } from "../config";

export const PROJECTS_ROOT = getProjectsRoot();
export const TEMPLATE_ROOT = getTemplatesRoot();

interface ProfileFileEntry {
  template?: string;
  output?: string;
  data?: unknown;
}

interface ProfileDocument {
  plugins?: Array<{ id: string; version?: string }>;
  configs?: {
    files?: ProfileFileEntry[];
  };
}

function getProfilePath(project: StoredProject): string {
  return project.profilePath ?? "profiles/base.yml";
}

export function resolveProjectRoot(project: StoredProject): string {
  const candidate = join(PROJECTS_ROOT, project.id);
  if (existsSync(candidate)) {
    return candidate;
  }
  return TEMPLATE_ROOT;
}

export async function readProjectFile(
  project: StoredProject,
  relativePath: string,
): Promise<string | undefined> {
  const root = resolveProjectRoot(project);
  const candidates = [join(root, relativePath)];
  if (root !== TEMPLATE_ROOT) {
    candidates.push(join(TEMPLATE_ROOT, relativePath));
  }

  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf-8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        console.warn(`Failed to read project file ${candidate}`, error);
      }
    }
  }

  return undefined;
}

async function readYamlDocument(project: StoredProject, relativePath: string): Promise<ProfileDocument | null> {
  const contents = await readProjectFile(project, relativePath);
  if (!contents) {
    return null;
  }

  try {
    return (parse(contents) as ProfileDocument) ?? null;
  } catch (error) {
    console.warn(`Failed to parse YAML for ${relativePath}`, error);
    return null;
  }
}

function listOverlayFiles(project: StoredProject): string[] {
  const projectOverlaysDir = join(resolveProjectRoot(project), "overlays");
  if (existsSync(projectOverlaysDir)) {
    return readdirSync(projectOverlaysDir)
      .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
      .map((file) => `overlays/${file}`);
  }

  const templateOverlaysDir = join(TEMPLATE_ROOT, "overlays");
  if (existsSync(templateOverlaysDir)) {
    return readdirSync(templateOverlaysDir)
      .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
      .map((file) => `overlays/${file}`);
  }

  return [];
}

export async function collectProjectDefinitionFiles(project: StoredProject): Promise<Record<string, string>> {
  const files: Record<string, string> = {};

  const profilePath = getProfilePath(project);
  const profileContent = await readProjectFile(project, profilePath);
  if (profileContent) {
    files[profilePath] = profileContent;
  }

  const supplementalPaths = ["plugins/registry.yml", ...listOverlayFiles(project)];
  for (const relative of supplementalPaths) {
    const content = await readProjectFile(project, relative);
    if (content) {
      files[relative] = content;
    }
  }

  return files;
}

async function listConfigFileEntries(project: StoredProject): Promise<ProfileFileEntry[]> {
  const profilePath = getProfilePath(project);
  const baseProfile = await readYamlDocument(project, profilePath);
  const entries: ProfileFileEntry[] = [];

  if (baseProfile?.configs?.files?.length) {
    entries.push(...baseProfile.configs.files);
  }

  return entries.filter((entry) => entry.template && entry.output);
}

interface RenderedConfigFile {
  path: string;
  content: string;
}

async function readTemplateFile(project: StoredProject, templateName: string): Promise<string | undefined> {
  const root = resolveProjectRoot(project);
  const candidates = [
    join(root, "configs", templateName),
    join(TEMPLATE_ROOT, "configs", templateName),
  ];

  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf-8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        console.warn(`Failed to read config template ${candidate}`, error);
      }
    }
  }

  return undefined;
}

export async function renderConfigFiles(project: StoredProject): Promise<RenderedConfigFile[]> {
  const entries = await listConfigFileEntries(project);
  const results: RenderedConfigFile[] = [];

  for (const entry of entries) {
    const templateSource = entry.template ? await readTemplateFile(project, entry.template) : undefined;
    if (!templateSource || !entry.output) {
      continue;
    }

    try {
      const template = Handlebars.compile(templateSource);
      const content = template({ data: entry.data ?? {} });
      results.push({
        path: entry.output,
        content,
      });
    } catch (error) {
      console.warn(`Failed to render config template ${entry.template}`, error);
    }
  }

  return results;
}


export async function writeProjectFileBuffer(
  project: StoredProject,
  relativePath: string,
  buffer: Buffer,
): Promise<string> {
  const targetRoot = join(PROJECTS_ROOT, project.id);
  const targetPath = join(targetRoot, relativePath);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, buffer);
  return targetPath;
}

export async function writeProjectFile(
  project: StoredProject,
  relativePath: string,
  contents: string,
): Promise<string> {
  return writeProjectFileBuffer(project, relativePath, Buffer.from(contents, "utf-8"));
}

export async function removePluginFromYamlFiles(
  project: StoredProject,
  pluginId: string,
): Promise<void> {
  const profilePath = getProfilePath(project);
  const profileContent = await readProjectFile(project, profilePath);
  
  if (profileContent) {
    try {
      const doc = parse(profileContent) as ProfileDocument;
      if (doc.plugins) {
        const originalLength = doc.plugins.length;
        doc.plugins = doc.plugins.filter((p) => p.id !== pluginId);
        if (doc.plugins.length !== originalLength) {
          const updatedYaml = stringify(doc, { defaultStringType: 'QUOTE_DOUBLE' });
          await writeProjectFile(project, profilePath, updatedYaml);
        }
      }
    } catch (error) {
      console.warn(`Failed to remove plugin from profile ${profilePath}`, error);
    }
  }

  const overlayFiles = listOverlayFiles(project);
  for (const overlayPath of overlayFiles) {
    const overlayContent = await readProjectFile(project, overlayPath);
    if (overlayContent) {
      try {
        const doc = parse(overlayContent) as ProfileDocument;
        if (doc.plugins) {
          const originalLength = doc.plugins.length;
          doc.plugins = doc.plugins.filter((p) => p.id !== pluginId);
          if (doc.plugins.length !== originalLength) {
            const updatedYaml = stringify(doc, { defaultStringType: 'QUOTE_DOUBLE' });
            await writeProjectFile(project, overlayPath, updatedYaml);
          }
        }
      } catch (error) {
        console.warn(`Failed to remove plugin from overlay ${overlayPath}`, error);
      }
    }
  }
}


