import type { SshConnectOptions } from "./sshConnection";
import {
  isTeledosiFilesConfigured,
  teledosiFilesMaxBytes,
  teledosiSftpPassword,
  teledosiSftpRemoteRoot,
} from "../config";
import { getTeledosiBaseSshOptions } from "./teledosiRemote";
import {
  sftpReadDir,
  sftpReadFullFile,
  sftpWriteFullFile,
  withSftpConnection,
  type SftpListEntry,
} from "./sftpClient";

export class TeledosiFileTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`File exceeds maximum size (${maxBytes} bytes)`);
    this.name = "TeledosiFileTooLargeError";
  }
}

function normalizeRoot(root: string): string {
  return root.trim().replace(/\/+$/, "") || "/";
}

/** SFTP auth: same key as SSH, or password from TELEDOSI_SFTP_PASSWORD / TELEDOSI_SSH_PASSWORD. */
export function getTeledosiFilesSshOptions(): SshConnectOptions {
  const o = getTeledosiBaseSshOptions();
  if (o.privateKey) {
    return o;
  }
  const password = (teledosiSftpPassword || o.password || "").trim();
  return { ...o, password };
}

function assertFilesConfigured(): void {
  if (!isTeledosiFilesConfigured()) {
    throw new Error("Teledosi files root is not configured");
  }
}

/** Join TELEDOSI_SFTP_REMOTE_ROOT with a relative path; rejects traversal. */
export function teledosiAbsoluteFromRelative(rel: string): string {
  const root = normalizeRoot(teledosiSftpRemoteRoot);
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

export function teledosiRelativeFromAbsolute(absPath: string): string {
  const root = normalizeRoot(teledosiSftpRemoteRoot);
  const norm = absPath.replace(/\/+$/, "") || "/";
  if (norm === root) {
    return "";
  }
  const prefix = `${root}/`;
  if (!norm.startsWith(prefix)) {
    throw new Error("Path outside Teledosi SFTP root");
  }
  return norm.slice(prefix.length);
}

export type TeledosiFileEntry = SftpListEntry & { relativePath: string };

export function mapEntriesToRelative(entries: SftpListEntry[]): TeledosiFileEntry[] {
  return entries.map((e) => ({
    ...e,
    relativePath: teledosiRelativeFromAbsolute(e.path),
  }));
}

export async function teledosiFilesList(relDir: string): Promise<TeledosiFileEntry[]> {
  assertFilesConfigured();
  const abs = teledosiAbsoluteFromRelative(relDir);
  const options = getTeledosiFilesSshOptions();
  const entries = await withSftpConnection(options, (conn) => sftpReadDir(conn, abs));
  return mapEntriesToRelative(entries);
}

export async function teledosiFilesRead(relPath: string): Promise<{ content: string; isBinary: boolean }> {
  assertFilesConfigured();
  const abs = teledosiAbsoluteFromRelative(relPath);
  const options = getTeledosiFilesSshOptions();
  const { buffer: buf, truncated } = await withSftpConnection(options, (conn) =>
    sftpReadFullFile(conn, abs, teledosiFilesMaxBytes),
  );
  if (truncated) {
    throw new TeledosiFileTooLargeError(teledosiFilesMaxBytes);
  }
  if (buf.includes(0)) {
    return { content: "", isBinary: true };
  }
  return { content: buf.toString("utf8"), isBinary: false };
}

export async function teledosiFilesWrite(relPath: string, content: string): Promise<void> {
  assertFilesConfigured();
  const abs = teledosiAbsoluteFromRelative(relPath);
  const buf = Buffer.from(content, "utf8");
  if (buf.length > teledosiFilesMaxBytes) {
    throw new Error(`File exceeds maximum size (${teledosiFilesMaxBytes} bytes)`);
  }
  const options = getTeledosiFilesSshOptions();
  await withSftpConnection(options, (conn) => sftpWriteFullFile(conn, abs, buf));
}
