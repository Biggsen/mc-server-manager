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
  for (const { id, envPrefix } of [
    { id: "teledosi", envPrefix: "TELEDOSI" },
    { id: "charidh", envPrefix: "CHARIDH" },
  ]) {
    const hostLen = (process.env[`${envPrefix}_SSH_HOST`] ?? "").trim().length;
    const userLen = (process.env[`${envPrefix}_SSH_USER`] ?? "").trim().length;
    const hasSecret =
      Boolean((process.env[`${envPrefix}_SSH_PASSWORD`] ?? "").length) ||
      Boolean((process.env[`${envPrefix}_SSH_PRIVATE_KEY`] ?? "").trim().length) ||
      Boolean((process.env[`${envPrefix}_SSH_PRIVATE_KEY_PATH`] ?? "").trim().length);
    console.log(
      `[config] Live server "${id}" env: hostLen=${hostLen} userLen=${userLen} hasPasswordOrKey=${hasSecret} (from ${envPath})`,
    );
  }
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

/** systemd unit names allowed for live servers (letters, digits, :, ., _, -, @). */
const LIVE_SERVER_UNIT_RE = /^[A-Za-z0-9:._@-]+$/;

export interface LiveServerConfig {
  id: string;
  envPrefix: string;
  ssh: {
    host: string;
    port: number;
    user: string;
    password: string;
    privateKeyEnv: string;
    privateKeyPath: string;
    passphrase: string;
  };
  systemdUnit: string;
  logsMaxLines: number;
  rcon: {
    wrapperBin: string;
    timeoutMs: number;
  };
  files: {
    remoteRoot: string;
    password: string;
    maxBytes: number;
  };
}

function readPrefixedEnv(prefix: string, key: string): string {
  return (process.env[`${prefix}_${key}`] ?? "").trim();
}

function parseSshPort(prefix: string): number {
  const parsed = Number(process.env[`${prefix}_SSH_PORT`]);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 65536 ? Math.floor(parsed) : 22;
}

function parseLogsMaxLines(prefix: string): number {
  const parsed = Number(process.env[`${prefix}_LOGS_MAX_LINES`]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(2000, Math.floor(parsed)) : 500;
}

function parseRconTimeoutMs(prefix: string): number {
  const parsed = Number(process.env[`${prefix}_RCON_TIMEOUT_MS`]);
  return Number.isFinite(parsed) && parsed >= 250 ? Math.min(30000, Math.floor(parsed)) : 5000;
}

function parseFilesMaxBytes(prefix: string): number {
  const parsed = Number(process.env[`${prefix}_FILES_MAX_BYTES`]);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(32 * 1024 * 1024, Math.floor(parsed))
    : 8 * 1024 * 1024;
}

export function buildLiveServerConfig(id: string, envPrefix: string): LiveServerConfig {
  const wrapperDefault = `${id}-rcon`;
  const systemdDefault = `minecraft-${id}`;
  const wrapperRaw = readPrefixedEnv(envPrefix, "RCON_WRAPPER_BIN");
  const systemdRaw = readPrefixedEnv(envPrefix, "SYSTEMD_UNIT");
  return {
    id,
    envPrefix,
    ssh: {
      host: readPrefixedEnv(envPrefix, "SSH_HOST"),
      port: parseSshPort(envPrefix),
      user: readPrefixedEnv(envPrefix, "SSH_USER"),
      password: process.env[`${envPrefix}_SSH_PASSWORD`] ?? "",
      privateKeyEnv: readPrefixedEnv(envPrefix, "SSH_PRIVATE_KEY"),
      privateKeyPath: readPrefixedEnv(envPrefix, "SSH_PRIVATE_KEY_PATH"),
      passphrase: process.env[`${envPrefix}_SSH_PASSPHRASE`] ?? "",
    },
    systemdUnit: (systemdRaw || systemdDefault).trim() || systemdDefault,
    logsMaxLines: parseLogsMaxLines(envPrefix),
    rcon: {
      wrapperBin: (wrapperRaw || wrapperDefault).trim() || wrapperDefault,
      timeoutMs: parseRconTimeoutMs(envPrefix),
    },
    files: {
      remoteRoot: readPrefixedEnv(envPrefix, "SFTP_REMOTE_ROOT"),
      password: process.env[`${envPrefix}_SFTP_PASSWORD`] ?? "",
      maxBytes: parseFilesMaxBytes(envPrefix),
    },
  };
}

export const teledosiConfig = buildLiveServerConfig("teledosi", "TELEDOSI");
export const charidhConfig = buildLiveServerConfig("charidh", "CHARIDH");

export const liveServers: LiveServerConfig[] = [teledosiConfig, charidhConfig];

export const liveServersById: Record<string, LiveServerConfig> = Object.fromEntries(
  liveServers.map((s) => [s.id, s]),
);

export function isValidLiveServerSystemdUnit(name: string): boolean {
  return LIVE_SERVER_UNIT_RE.test(name) && name.length > 0 && name.length <= 256;
}

export function getResolvedPrivateKeyPem(cfg: LiveServerConfig): string | undefined {
  if (cfg.ssh.privateKeyEnv) {
    return cfg.ssh.privateKeyEnv.replace(/\\n/g, "\n");
  }
  if (cfg.ssh.privateKeyPath) {
    return readFileSync(cfg.ssh.privateKeyPath, "utf8");
  }
  return undefined;
}

/** SSH host/user/auth only (no systemd unit requirement). */
export function isLiveServerSshConfigured(cfg: LiveServerConfig): boolean {
  if (!cfg.ssh.host || !cfg.ssh.user) {
    return false;
  }
  if (cfg.ssh.privateKeyEnv || cfg.ssh.privateKeyPath) {
    return true;
  }
  return cfg.ssh.password.length > 0;
}

/** Remote control readiness (includes valid systemd unit). */
export function isLiveServerConfigured(cfg: LiveServerConfig): boolean {
  if (!isLiveServerSshConfigured(cfg) || !isValidLiveServerSystemdUnit(cfg.systemdUnit)) {
    return false;
  }
  return true;
}

export function liveServerNotConfiguredMessage(cfg: LiveServerConfig): string {
  return `Live server remote control is not configured. Set ${cfg.envPrefix}_SSH_HOST, ${cfg.envPrefix}_SSH_USER, and ${cfg.envPrefix}_SSH_PASSWORD or ${cfg.envPrefix}_SSH_PRIVATE_KEY / ${cfg.envPrefix}_SSH_PRIVATE_KEY_PATH in the backend environment.`;
}

export function isLiveServerRconConfigured(cfg: LiveServerConfig): boolean {
  return isLiveServerSshConfigured(cfg) && cfg.rcon.wrapperBin.length > 0;
}

export function liveServerRconNotConfiguredMessage(cfg: LiveServerConfig): string {
  return `Live server RCON wrapper is not configured. Set ${cfg.envPrefix}_RCON_WRAPPER_BIN in the backend environment.`;
}

export function liveServerRconTransportErrorMessage(cfg: LiveServerConfig): string {
  return `Live server command transport failed over SSH. Verify ${cfg.envPrefix}_SSH_* connectivity and ${cfg.envPrefix}_RCON_WRAPPER_BIN on the VPS.`;
}

export function isLiveServerFilesConfigured(cfg: LiveServerConfig): boolean {
  if (!isLiveServerSshConfigured(cfg)) {
    return false;
  }
  const root = cfg.files.remoteRoot;
  if (!root.startsWith("/") || root === "/") {
    return false;
  }
  return true;
}

export function liveServerFilesNotConfiguredMessage(cfg: LiveServerConfig): string {
  return `Live server remote files are not configured. Set ${cfg.envPrefix}_SFTP_REMOTE_ROOT to an absolute directory on the VPS (for example the SFTP remote path you use on the Upload page), then restart the backend.`;
}

/** @deprecated Use isValidLiveServerSystemdUnit */
export function isValidTeledosiSystemdUnit(name: string): boolean {
  return isValidLiveServerSystemdUnit(name);
}

/** @deprecated Use teledosiConfig and isLiveServerSshConfigured */
export const teledosiSshHost = teledosiConfig.ssh.host;
export const teledosiSshPort = teledosiConfig.ssh.port;
export const teledosiSshUser = teledosiConfig.ssh.user;
export const teledosiSshPassword = teledosiConfig.ssh.password;
export const teledosiSshPrivateKeyEnv = teledosiConfig.ssh.privateKeyEnv;
export const teledosiSshPrivateKeyPath = teledosiConfig.ssh.privateKeyPath;
export const teledosiSshPassphrase = teledosiConfig.ssh.passphrase;
export const teledosiSystemdUnit = teledosiConfig.systemdUnit;
export const teledosiLogsMaxLines = teledosiConfig.logsMaxLines;

export function isTeledosiSshConfigured(): boolean {
  return isLiveServerSshConfigured(teledosiConfig);
}

export function isTeledosiConfigured(): boolean {
  return isLiveServerConfigured(teledosiConfig);
}

export const TELEDOSI_NOT_CONFIGURED_MESSAGE = liveServerNotConfiguredMessage(teledosiConfig);

export function isTeledosiRconConfigured(): boolean {
  return isLiveServerRconConfigured(teledosiConfig);
}

export const teledosiRconWrapperBin = teledosiConfig.rcon.wrapperBin;
export const teledosiRconTimeoutMs = teledosiConfig.rcon.timeoutMs;

export const TELEDOSI_RCON_NOT_CONFIGURED_MESSAGE = liveServerRconNotConfiguredMessage(teledosiConfig);
export const TELEDOSI_RCON_TRANSPORT_ERROR_MESSAGE = liveServerRconTransportErrorMessage(teledosiConfig);

/** @deprecated Use getResolvedPrivateKeyPem(teledosiConfig) */
export function getTeledosiPrivateKeyPem(): string | undefined {
  return getResolvedPrivateKeyPem(teledosiConfig);
}

export const teledosiSftpRemoteRoot = teledosiConfig.files.remoteRoot;
export const teledosiSftpPassword = teledosiConfig.files.password;
export const teledosiFilesMaxBytes = teledosiConfig.files.maxBytes;

export function isTeledosiFilesConfigured(): boolean {
  return isLiveServerFilesConfigured(teledosiConfig);
}

export const TELEDOSI_FILES_NOT_CONFIGURED_MESSAGE = liveServerFilesNotConfiguredMessage(teledosiConfig);
