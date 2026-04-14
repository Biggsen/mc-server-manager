/**
 * Normalizes the optional plugin data directory name (single segment under plugins/).
 * Returns undefined to mean "use the plugin id as the folder name".
 */
export function normalizePluginDataFolder(input: unknown): string | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }
  if (typeof input !== "string") {
    throw new Error("dataFolder must be a string");
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    throw new Error("dataFolder must be a single folder name (no slashes or ..)");
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    throw new Error("dataFolder may only contain letters, digits, and . _ -");
  }
  return trimmed;
}
