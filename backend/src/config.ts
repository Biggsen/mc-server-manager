import { config as loadEnv } from "dotenv";
import { join } from "path";
import { readFileSync } from "fs";

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

const dotenvResult = loadEnv({
  path: envPath,
  // Electron may inherit empty TELEDOSI_* from the parent process; file must win.
  override: process.env.ELECTRON_MODE === "true",
});
if (dotenvResult.error && process.env.ELECTRON_MODE === "true") {
  console.warn(`[config] dotenv could not read ${envPath}:`, dotenvResult.error.message);
}
if (process.env.ELECTRON_MODE === "true" && process.env.USER_DATA_PATH) {
  const hostLen = (process.env.TELEDOSI_SSH_HOST ?? "").trim().length;
  const userLen = (process.env.TELEDOSI_SSH_USER ?? "").trim().length;
  const hasSecret =
    Boolean((process.env.TELEDOSI_SSH_PASSWORD ?? "").length) ||
    Boolean((process.env.TELEDOSI_SSH_PRIVATE_KEY ?? "").trim().length) ||
    Boolean((process.env.TELEDOSI_SSH_PRIVATE_KEY_PATH ?? "").trim().length);
  console.log(
    `[config] Teledosi env: hostLen=${hostLen} userLen=${userLen} hasPasswordOrKey=${hasSecret} (from ${envPath})`,
  );
}

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
 * Get the deployments root directory (deployment zip artifacts).
 */
export function getDeploymentsRoot(): string {
  return join(getDataRoot(), "data", "deployments");
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

const parsedConfigPayloadMb = Number(process.env.MCSM_MAX_CONFIG_PAYLOAD_MB);
/** Max JSON body size and config multipart upload size (single file). Default 32 MiB. */
export const maxConfigPayloadBytes =
  Number.isFinite(parsedConfigPayloadMb) && parsedConfigPayloadMb > 0
    ? Math.floor(parsedConfigPayloadMb * 1024 * 1024)
    : 32 * 1024 * 1024;

export function describeMaxConfigPayload(): string {
  const mb = maxConfigPayloadBytes / (1024 * 1024);
  return Number.isInteger(mb) ? `${mb} MB` : `${mb.toFixed(1)} MB`;
}

/** Remote VPS SSH (Teledosi systemd / journalctl). Password or private key required when host and user are set. */
export const teledosiSshHost = (process.env.TELEDOSI_SSH_HOST ?? "").trim();
const teledosiPortParsed = Number(process.env.TELEDOSI_SSH_PORT);
export const teledosiSshPort =
  Number.isFinite(teledosiPortParsed) && teledosiPortParsed > 0 && teledosiPortParsed < 65536
    ? Math.floor(teledosiPortParsed)
    : 22;
export const teledosiSshUser = (process.env.TELEDOSI_SSH_USER ?? "").trim();
export const teledosiSshPassword = process.env.TELEDOSI_SSH_PASSWORD ?? "";
export const teledosiSshPrivateKeyEnv = (process.env.TELEDOSI_SSH_PRIVATE_KEY ?? "").trim();
export const teledosiSshPrivateKeyPath = (process.env.TELEDOSI_SSH_PRIVATE_KEY_PATH ?? "").trim();
export const teledosiSshPassphrase = process.env.TELEDOSI_SSH_PASSPHRASE ?? "";
export const teledosiSystemdUnit =
  (process.env.TELEDOSI_SYSTEMD_UNIT ?? "minecraft-teledosi").trim() || "minecraft-teledosi";
const teledosiLogsMaxParsed = Number(process.env.TELEDOSI_LOGS_MAX_LINES);
/** Server-side cap for GET /logs ?lines= */
export const teledosiLogsMaxLines =
  Number.isFinite(teledosiLogsMaxParsed) && teledosiLogsMaxParsed > 0
    ? Math.min(2000, Math.floor(teledosiLogsMaxParsed))
    : 500;

const TELEDOSI_UNIT_RE = /^[A-Za-z0-9:._@-]+$/;

export function isValidTeledosiSystemdUnit(name: string): boolean {
  return TELEDOSI_UNIT_RE.test(name) && name.length > 0 && name.length <= 256;
}

export function isTeledosiConfigured(): boolean {
  if (!teledosiSshHost || !teledosiSshUser || !isValidTeledosiSystemdUnit(teledosiSystemdUnit)) {
    return false;
  }
  if (teledosiSshPrivateKeyEnv || teledosiSshPrivateKeyPath) {
    return true;
  }
  return teledosiSshPassword.length > 0;
}

export const TELEDOSI_NOT_CONFIGURED_MESSAGE =
  "Teledosi remote control is not configured. Set TELEDOSI_SSH_HOST, TELEDOSI_SSH_USER, and TELEDOSI_SSH_PASSWORD or TELEDOSI_SSH_PRIVATE_KEY / TELEDOSI_SSH_PRIVATE_KEY_PATH in the backend environment.";

/**
 * Resolved private key for SSH (env body, or file path). Throws if path is set but unreadable.
 */
export function getTeledosiPrivateKeyPem(): string | undefined {
  if (teledosiSshPrivateKeyEnv) {
    return teledosiSshPrivateKeyEnv.replace(/\\n/g, "\n");
  }
  if (teledosiSshPrivateKeyPath) {
    return readFileSync(teledosiSshPrivateKeyPath, "utf8");
  }
  return undefined;
}

/**
 * Absolute directory on the Teledosi VPS for SFTP file browser/editor (same SSH host as TELEDOSI_SSH_*).
 * Use the same path you set for project SFTP "remote path" in Upload, e.g. /home/mc/server
 */
export const teledosiSftpRemoteRoot = (process.env.TELEDOSI_SFTP_REMOTE_ROOT ?? "").trim();

/**
 * Optional SFTP password when it differs from TELEDOSI_SSH_PASSWORD (ignored when authenticating with a private key).
 */
export const teledosiSftpPassword = process.env.TELEDOSI_SFTP_PASSWORD ?? "";

const teledosiFilesMaxParsed = Number(process.env.TELEDOSI_FILES_MAX_BYTES);
/** Max bytes for read/write of a single file via Teledosi file editor. Default 8 MiB, cap 32 MiB. */
export const teledosiFilesMaxBytes =
  Number.isFinite(teledosiFilesMaxParsed) && teledosiFilesMaxParsed > 0
    ? Math.min(32 * 1024 * 1024, Math.floor(teledosiFilesMaxParsed))
    : 8 * 1024 * 1024;

export function isTeledosiFilesConfigured(): boolean {
  if (!isTeledosiConfigured()) {
    return false;
  }
  const root = teledosiSftpRemoteRoot;
  if (!root.startsWith("/") || root === "/") {
    return false;
  }
  return true;
}

export const TELEDOSI_FILES_NOT_CONFIGURED_MESSAGE =
  "Teledosi remote files are not configured. Set TELEDOSI_SFTP_REMOTE_ROOT to an absolute directory on the VPS (for example the SFTP remote path you use on the Upload page), then restart the backend.";
