import { readFile, writeFile, rm } from "fs/promises";
import { join } from "path";
import { parse } from "yaml";
import type { InitializationMarker, InitCommand } from "../types/initCommands";

const MARKER_FILENAME = ".initialized";

export interface ProfileDocument {
  plugins?: Array<{ id: string; version?: string }>;
  configs?: {
    files?: Array<{ template?: string; output?: string; data?: unknown }>;
  };
  initCommands?: string[] | InitCommand[];
}

export function getMarkerPath(workspacePath: string): string {
  return join(workspacePath, MARKER_FILENAME);
}

export async function shouldExecuteInitCommands(
  workspacePath: string,
  currentBuildId: string,
): Promise<boolean> {
  const markerPath = getMarkerPath(workspacePath);
  try {
    const content = await readFile(markerPath, "utf-8");
    const marker = JSON.parse(content) as InitializationMarker;
    return marker.buildId !== currentBuildId;
  } catch {
    return true;
  }
}

export async function readInitializationMarker(
  workspacePath: string,
): Promise<InitializationMarker | null> {
  const markerPath = getMarkerPath(workspacePath);
  try {
    const content = await readFile(markerPath, "utf-8");
    return JSON.parse(content) as InitializationMarker;
  } catch {
    return null;
  }
}

export async function markAsInitialized(
  workspacePath: string,
  commands: string[],
  projectId: string,
  buildId: string,
): Promise<void> {
  const markerPath = getMarkerPath(workspacePath);
  const marker: InitializationMarker = {
    initializedAt: new Date().toISOString(),
    commands,
    projectId,
    buildId,
  };
  await writeFile(markerPath, JSON.stringify(marker, null, 2), "utf-8");
}

export async function clearInitializationMarker(workspacePath: string): Promise<void> {
  const markerPath = getMarkerPath(workspacePath);
  await rm(markerPath, { force: true }).catch(() => {});
}

export function getInitCommands(
  baseProfile: ProfileDocument | null,
  overlays: ProfileDocument[],
): string[] {
  const commands: string[] = [];

  if (baseProfile?.initCommands) {
    for (const cmd of baseProfile.initCommands) {
      if (typeof cmd === "string") {
        commands.push(cmd);
      } else {
        commands.push(cmd.command);
      }
    }
  }

  for (const overlay of overlays) {
    if (overlay.initCommands) {
      for (const cmd of overlay.initCommands) {
        if (typeof cmd === "string") {
          commands.push(cmd);
        } else {
          commands.push(cmd.command);
        }
      }
    }
  }

  return commands;
}
