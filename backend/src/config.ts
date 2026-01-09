import { config as loadEnv } from "dotenv";
import { join } from "path";

// In Electron mode, load .env from userData
// In dev mode, load from project root
let envPath = process.env.ENV_FILE;
if (!envPath) {
  if (process.env.ELECTRON_MODE === "true" && process.env.USER_DATA_PATH) {
    envPath = join(process.env.USER_DATA_PATH, ".env");
  } else {
    envPath = "./.env";
  }
}

loadEnv({ path: envPath });

export const githubClientId = process.env.GITHUB_CLIENT_ID ?? "";
export const githubClientSecret = process.env.GITHUB_CLIENT_SECRET ?? "";
export const authCallbackUrl =
  process.env.AUTH_CALLBACK_URL ?? "http://localhost:4000/api/auth/github/callback";
export const jwtSecret = process.env.JWT_SECRET ?? "development-secret-change-in-production";
export const jwtExpiry = process.env.JWT_EXPIRY ?? "30d";
export const githubScope = process.env.GITHUB_SCOPE ?? "repo delete_repo read:user";
export const appBaseUrl = process.env.APP_BASE_URL ?? "http://localhost:5173";

export function requireAuthConfig(): void {
  if (!githubClientId || !githubClientSecret) {
    console.warn("GitHub OAuth not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in your .env file.");
  }
}

/**
 * Get the root directory for application data.
 * In Electron mode, uses app.getPath('userData').
 * In web mode, uses process.cwd().
 */
export function getDataRoot(): string {
  const electronMode = process.env.ELECTRON_MODE === "true";
  const userDataPath = process.env.USER_DATA_PATH;
  
  if (electronMode && userDataPath) {
    return userDataPath;
  }
  
  return process.cwd();
}

/**
 * Get the projects root directory.
 */
export function getProjectsRoot(): string {
  return join(getDataRoot(), "data", "projects");
}

/**
 * Get the builds root directory.
 */
export function getBuildsRoot(): string {
  return join(getDataRoot(), "data", "builds");
}

/**
 * Get the runs root directory.
 */
export function getRunsRoot(): string {
  return join(getDataRoot(), "data", "runs");
}

/**
 * Get the cache root directory.
 */
export function getCacheRoot(): string {
  return join(getDataRoot(), "data", "cache");
}

/**
 * Get the templates root directory.
 * In Electron mode, templates are bundled with the app.
 * In web mode, templates are relative to project root.
 */
export function getTemplatesRoot(): string {
  if (process.env.ELECTRON_MODE === "true") {
    // In Electron, templates are bundled with the app
    // __dirname will be in backend/dist, so go up to root
    return join(__dirname, "../../templates/server");
  }
  return join(process.cwd(), "..", "templates", "server");
}

/**
 * Get possible development directory paths for migration purposes.
 * Returns an array of paths to check for development data that might need migration.
 * In Electron mode, checks various possible locations where dev data might exist.
 * In web/dev mode, returns the current working directory.
 */
export function getDevDataPaths(): string[] {
  if (process.env.ELECTRON_MODE === "true") {
    // In Electron, check multiple possible locations for dev data
    // __dirname is in backend/dist, so we need to go up to find the source
    return [
      join(__dirname, "..", "..", "..", "backend", "data"),
      join(__dirname, "..", "..", "backend", "data"),
    ];
  }
  // In dev mode, use current working directory
  return [join(process.cwd(), "backend", "data")];
}
