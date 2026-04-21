import type { Client } from "ssh2";
import {
  getTeledosiPrivateKeyPem,
  isTeledosiConfigured,
  isValidTeledosiSystemdUnit,
  teledosiLogsMaxLines,
  teledosiSshHost,
  teledosiSshPassword,
  teledosiSshPassphrase,
  teledosiSshPort,
  teledosiSshUser,
  teledosiSystemdUnit,
} from "../config";
import { connectSsh2, type SshConnectOptions } from "./sshConnection";

function assertUnitName(unit: string): void {
  if (!isValidTeledosiSystemdUnit(unit)) {
    throw new Error("Invalid TELEDOSI_SYSTEMD_UNIT (allowed: letters, digits, :, ., _, -, @)");
  }
}

/** Match `TELEDOSI_USE_SUDO` — default use sudo -n for start/stop/restart */
function useSudoForSystemctl(): boolean {
  const v = (process.env.TELEDOSI_USE_SUDO ?? "1").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "no";
}

export function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** SSH options for Teledosi host auth (no systemd validation). */
export function getTeledosiBaseSshOptions(): SshConnectOptions {
  const key = getTeledosiPrivateKeyPem();
  const base: SshConnectOptions = {
    host: teledosiSshHost,
    port: teledosiSshPort,
    username: teledosiSshUser,
  };
  if (key) {
    return {
      ...base,
      privateKey: key,
      passphrase: teledosiSshPassphrase || undefined,
    };
  }
  return {
    ...base,
    password: teledosiSshPassword,
  };
}

export function getTeledosiSshOptions(): SshConnectOptions {
  assertUnitName(teledosiSystemdUnit);
  return getTeledosiBaseSshOptions();
}

export async function connectTeledosiClient(): Promise<Client> {
  if (!isTeledosiConfigured()) {
    throw new Error("Teledosi is not configured");
  }
  return connectSsh2(getTeledosiSshOptions());
}

export async function withTeledosiSsh<T>(fn: (conn: Client) => Promise<T>): Promise<T> {
  if (!isTeledosiConfigured()) {
    throw new Error("Teledosi is not configured");
  }
  const conn = await connectSsh2(getTeledosiSshOptions());
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

export type TeledosiServiceState = "running" | "stopped" | "failed";

export async function getTeledosiStatus(): Promise<{
  state: TeledosiServiceState;
  raw: string;
}> {
  const u = shellSingleQuote(teledosiSystemdUnit);
  const { stdout, stderr, code } = await withTeledosiSsh((conn) =>
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

function systemctlActionCmd(action: "start" | "stop" | "restart"): string {
  const u = shellSingleQuote(teledosiSystemdUnit);
  return useSudoForSystemctl()
    ? `sudo -n systemctl ${action} ${u} 2>&1`
    : `systemctl ${action} ${u} 2>&1`;
}

export async function teledosiSystemctl(action: "start" | "stop" | "restart"): Promise<ExecResult> {
  return withTeledosiSsh((conn) => execBuffered(conn, systemctlActionCmd(action)));
}

export function clampLogLines(requested: number | undefined): number {
  const n = typeof requested === "number" && Number.isFinite(requested) ? Math.floor(requested) : 200;
  return Math.max(1, Math.min(teledosiLogsMaxLines, n));
}

export async function getTeledosiRecentLogs(lines?: number): Promise<string> {
  const n = clampLogLines(lines);
  const u = shellSingleQuote(teledosiSystemdUnit);
  const cmd = `journalctl -u ${u} -n ${n} --no-pager -o short-iso 2>&1`;
  const { stdout, stderr } = await withTeledosiSsh((conn) => execBuffered(conn, cmd));
  return stdout + (stderr ? (stdout ? "\n" : "") + stderr : "");
}

/**
 * Stream `journalctl -f` until the connection is closed. Call `conn.end()` to stop.
 */
export function streamTeledosiJournalFollow(
  conn: Client,
  onLine: (line: string) => void,
  onError: (err: Error) => void,
): void {
  const u = shellSingleQuote(teledosiSystemdUnit);
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
    stream.on("error", (e: unknown) =>
      onError(e instanceof Error ? e : new Error(String(e))),
    );
    stream.on("close", () => {
      if (buf.trim().length) onLine(buf.trimEnd());
    });
  });
}
