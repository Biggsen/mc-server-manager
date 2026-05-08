import type { LiveServerConfig } from "../config";
import { isLiveServerFilesConfigured } from "../config";
import type { SshConnectOptions } from "./sshConnection";
import { getLiveServerBaseSshOptions } from "./liveServerRemote";
import {
  sftpReadDir,
  sftpReadFullFile,
  sftpWriteFullFile,
  withSftpConnection,
  type SftpListEntry,
} from "./sftpClient";

export class LiveServerFileTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`File exceeds maximum size (${maxBytes} bytes)`);
    this.name = "LiveServerFileTooLargeError";
  }
}

/** @deprecated */
export const TeledosiFileTooLargeError = LiveServerFileTooLargeError;

function normalizeRoot(root: string): string {
  return root.trim().replace(/\/+$/, "") || "/";
}

/** SFTP auth: same key as SSH, or password from SFTP_PASSWORD / SSH_PASSWORD. */
export function getLiveServerFilesSshOptions(cfg: LiveServerConfig): SshConnectOptions {
  const o = getLiveServerBaseSshOptions(cfg);
  if (o.privateKey) {
    return o;
  }
  const password = (cfg.files.password || o.password || "").trim();
  return { ...o, password };
}

function assertFilesConfigured(cfg: LiveServerConfig): void {
  if (!isLiveServerFilesConfigured(cfg)) {
    throw new Error(`Live server "${cfg.id}" files root is not configured`);
  }
}

/** Join SFTP_REMOTE_ROOT with a relative path; rejects traversal. */
export function liveServerAbsoluteFromRelative(cfg: LiveServerConfig, rel: string): string {
  const root = normalizeRoot(cfg.files.remoteRoot);
  const raw = (rel ?? "").replace(/\\/g, "/").trim();
  const segments = raw.split("/").filter((s) => s.length > 0 && s !== ".");
  if (segments.some((s) => s === "..")) {
    throw new Error("Invalid path");
  }
  if (segments.length === 0) {
    return root;
  }
  return `${root}/${segments.join("/")}`.replace(/\/+/g, "/");
}

export function liveServerRelativeFromAbsolute(cfg: LiveServerConfig, absPath: string): string {
  const root = normalizeRoot(cfg.files.remoteRoot);
  const norm = absPath.replace(/\/+$/, "") || "/";
  if (norm === root) {
    return "";
  }
  const prefix = `${root}/`;
  if (!norm.startsWith(prefix)) {
    throw new Error("Path outside live server SFTP root");
  }
  return norm.slice(prefix.length);
}

export type LiveServerFileEntry = SftpListEntry & { relativePath: string };

export function mapEntriesToRelative(
  cfg: LiveServerConfig,
  entries: SftpListEntry[],
): LiveServerFileEntry[] {
  return entries.map((e) => ({
    ...e,
    relativePath: liveServerRelativeFromAbsolute(cfg, e.path),
  }));
}

export async function liveServerFilesList(
  cfg: LiveServerConfig,
  relDir: string,
): Promise<LiveServerFileEntry[]> {
  assertFilesConfigured(cfg);
  const abs = liveServerAbsoluteFromRelative(cfg, relDir);
  const options = getLiveServerFilesSshOptions(cfg);
  const entries = await withSftpConnection(options, (conn) => sftpReadDir(conn, abs));
  return mapEntriesToRelative(cfg, entries);
}

export async function liveServerFilesRead(
  cfg: LiveServerConfig,
  relPath: string,
): Promise<{ content: string; isBinary: boolean }> {
  assertFilesConfigured(cfg);
  const abs = liveServerAbsoluteFromRelative(cfg, relPath);
  const options = getLiveServerFilesSshOptions(cfg);
  const maxBytes = cfg.files.maxBytes;
  const { buffer: buf, truncated } = await withSftpConnection(options, (conn) =>
    sftpReadFullFile(conn, abs, maxBytes),
  );
  if (truncated) {
    throw new LiveServerFileTooLargeError(maxBytes);
  }
  if (buf.includes(0)) {
    return { content: "", isBinary: true };
  }
  return { content: buf.toString("utf8"), isBinary: false };
}

export async function liveServerFilesWrite(
  cfg: LiveServerConfig,
  relPath: string,
  content: string,
): Promise<void> {
  assertFilesConfigured(cfg);
  const abs = liveServerAbsoluteFromRelative(cfg, relPath);
  const buf = Buffer.from(content, "utf8");
  const maxBytes = cfg.files.maxBytes;
  if (buf.length > maxBytes) {
    throw new Error(`File exceeds maximum size (${maxBytes} bytes)`);
  }
  const options = getLiveServerFilesSshOptions(cfg);
  await withSftpConnection(options, (conn) => sftpWriteFullFile(conn, abs, buf));
}
