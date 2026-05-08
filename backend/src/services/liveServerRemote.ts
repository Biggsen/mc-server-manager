import type { Client } from "ssh2";
import type { LiveServerConfig } from "../config";
import {
  getResolvedPrivateKeyPem,
  isLiveServerConfigured,
  isValidLiveServerSystemdUnit,
} from "../config";
import { connectSsh2, type SshConnectOptions } from "./sshConnection";

function assertUnitName(unit: string): void {
  if (!isValidLiveServerSystemdUnit(unit)) {
    throw new Error("Invalid systemd unit name (allowed: letters, digits, :, ., _, -, @)");
  }
}

/** Match `${PREFIX}_USE_SUDO` — default use sudo -n for start/stop/restart */
function useSudoForSystemctl(cfg: LiveServerConfig): boolean {
  const v = (process.env[`${cfg.envPrefix}_USE_SUDO`] ?? "1").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "no";
}

export function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** SSH options for live server host auth (no systemd validation). */
export function getLiveServerBaseSshOptions(cfg: LiveServerConfig): SshConnectOptions {
  const key = getResolvedPrivateKeyPem(cfg);
  const base: SshConnectOptions = {
    host: cfg.ssh.host,
    port: cfg.ssh.port,
    username: cfg.ssh.user,
  };
  if (key) {
    return {
      ...base,
      privateKey: key,
      passphrase: cfg.ssh.passphrase || undefined,
    };
  }
  return {
    ...base,
    password: cfg.ssh.password,
  };
}

export function getLiveServerSshOptions(cfg: LiveServerConfig): SshConnectOptions {
  assertUnitName(cfg.systemdUnit);
  return getLiveServerBaseSshOptions(cfg);
}

export async function connectLiveServerClient(cfg: LiveServerConfig): Promise<Client> {
  if (!isLiveServerConfigured(cfg)) {
    throw new Error(`Live server "${cfg.id}" is not configured`);
  }
  return connectSsh2(getLiveServerSshOptions(cfg));
}

export async function withLiveServerSsh<T>(
  cfg: LiveServerConfig,
  fn: (conn: Client) => Promise<T>,
): Promise<T> {
  if (!isLiveServerConfigured(cfg)) {
    throw new Error(`Live server "${cfg.id}" is not configured`);
  }
  const conn = await connectSsh2(getLiveServerSshOptions(cfg));
  try {
    return await fn(conn);
  } finally {
    conn.end();
  }
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export function execBuffered(conn: Client, command: string): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      const chunksOut: Buffer[] = [];
      const chunksErr: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunksOut.push(chunk));
      stream.stderr.on("data", (chunk: Buffer) => chunksErr.push(chunk));
      stream.on("close", (code: number | null) => {
        resolve({
          stdout: Buffer.concat(chunksOut).toString("utf8"),
          stderr: Buffer.concat(chunksErr).toString("utf8"),
          code,
        });
      });
      stream.on("error", reject);
    });
  });
}

export type LiveServerServiceState = "running" | "stopped" | "failed";

export async function getLiveServerStatus(
  cfg: LiveServerConfig,
): Promise<{ state: LiveServerServiceState; raw: string }> {
  const u = shellSingleQuote(cfg.systemdUnit);
  const { stdout, stderr, code } = await withLiveServerSsh(cfg, (conn) =>
    execBuffered(conn, `systemctl is-active ${u} 2>&1`),
  );
  const raw = (stdout + stderr).trim();
  const line = raw.split(/\r?\n/)[0]?.trim() ?? "";

  if (line === "active") {
    return { state: "running", raw: line };
  }
  if (line === "failed") {
    return { state: "failed", raw: line };
  }
  if (line === "inactive" || line === "unknown") {
    return { state: "stopped", raw: line };
  }
  if (code !== 0 && /activating|deactivating/i.test(line)) {
    return { state: "stopped", raw: line };
  }
  if (code !== 0) {
    return { state: "failed", raw: line || `exit ${code}` };
  }
  return { state: "stopped", raw: line };
}

function systemctlActionCmd(cfg: LiveServerConfig, action: "start" | "stop" | "restart"): string {
  const u = shellSingleQuote(cfg.systemdUnit);
  return useSudoForSystemctl(cfg)
    ? `sudo -n systemctl ${action} ${u} 2>&1`
    : `systemctl ${action} ${u} 2>&1`;
}

export async function liveServerSystemctl(
  cfg: LiveServerConfig,
  action: "start" | "stop" | "restart",
): Promise<ExecResult> {
  return withLiveServerSsh(cfg, (conn) => execBuffered(conn, systemctlActionCmd(cfg, action)));
}

export function clampLogLines(cfg: LiveServerConfig, requested: number | undefined): number {
  const n = typeof requested === "number" && Number.isFinite(requested) ? Math.floor(requested) : 200;
  return Math.max(1, Math.min(cfg.logsMaxLines, n));
}

export async function getLiveServerRecentLogs(
  cfg: LiveServerConfig,
  lines?: number,
): Promise<string> {
  const n = clampLogLines(cfg, lines);
  const u = shellSingleQuote(cfg.systemdUnit);
  const cmd = `journalctl -u ${u} -n ${n} --no-pager -o short-iso 2>&1`;
  const { stdout, stderr } = await withLiveServerSsh(cfg, (conn) => execBuffered(conn, cmd));
  return stdout + (stderr ? (stdout ? "\n" : "") + stderr : "");
}

/**
 * Stream `journalctl -f` until the connection is closed. Call `conn.end()` to stop.
 */
export function streamLiveServerJournalFollow(
  cfg: LiveServerConfig,
  conn: Client,
  onLine: (line: string) => void,
  onError: (err: Error) => void,
): void {
  const u = shellSingleQuote(cfg.systemdUnit);
  const cmd = `journalctl -u ${u} -f -n 100 --no-pager -o short-iso 2>&1`;
  conn.exec(cmd, (err, stream) => {
    if (err) {
      onError(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    let buf = "";
    const flush = (chunk: string) => {
      buf += chunk;
      const parts = buf.split(/\r?\n/);
      buf = parts.pop() ?? "";
      for (const line of parts) {
        if (line.length) onLine(line);
      }
    };
    stream.on("data", (chunk: Buffer) => flush(chunk.toString("utf8")));
    stream.stderr.on("data", (chunk: Buffer) => flush(chunk.toString("utf8")));
    stream.on("error", (e: unknown) => onError(e instanceof Error ? e : new Error(String(e))));
    stream.on("close", () => {
      if (buf.trim().length) onLine(buf.trimEnd());
    });
  });
}
