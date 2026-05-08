import type { SshConnectOptions } from "./sshConnection";
import { connectSsh2 } from "./sshConnection";
import { createWriteStream } from "fs";
import { mkdir, stat } from "fs/promises";
import { dirname } from "path";
import { pipeline } from "stream/promises";
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

export class TeledosiBackupCancelledError extends Error {
  constructor() {
    super("Backup download cancelled");
    this.name = "TeledosiBackupCancelledError";
  }
}

export class TeledosiBackupSizeMismatchError extends Error {
  constructor(
    public readonly remoteSize: number,
    public readonly localSize: number,
  ) {
    super(`Backup size mismatch (remote=${remoteSize} bytes, local=${localSize} bytes)`);
    this.name = "TeledosiBackupSizeMismatchError";
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

const TELEDOSI_BACKUPS_ROOT = "/opt/minecraft/backups";

function teledosiBackupAbsolutePath(fileName: string): string {
  const trimmed = (fileName ?? "").trim().replace(/\\/g, "/");
  if (!trimmed || trimmed.includes("/")) {
    throw new Error("Invalid backup file");
  }
  if (!/^[^\0\r\n"]+$/.test(trimmed)) {
    throw new Error("Invalid backup file");
  }
  if (trimmed === "." || trimmed === "..") {
    throw new Error("Invalid backup file");
  }
  return `${TELEDOSI_BACKUPS_ROOT}/${trimmed}`;
}

export async function teledosiBackupsList(): Promise<SftpListEntry[]> {
  const options = getTeledosiFilesSshOptions();
  const entries = await withSftpConnection(options, (conn) => sftpReadDir(conn, TELEDOSI_BACKUPS_ROOT));
  return entries.filter((entry) => entry.type === "file");
}

export async function teledosiBackupRead(fileName: string): Promise<Buffer> {
  const options = getTeledosiFilesSshOptions();
  const absPath = teledosiBackupAbsolutePath(fileName);
  const { buffer, truncated } = await withSftpConnection(options, (conn) =>
    sftpReadFullFile(conn, absPath, Number.MAX_SAFE_INTEGER),
  );
  if (truncated) {
    throw new Error("Backup file is too large to download");
  }
  return buffer;
}

export async function teledosiBackupCreateReadStream(fileName: string): Promise<{
  stream: NodeJS.ReadableStream;
  close: () => void;
}> {
  const options = getTeledosiFilesSshOptions();
  const absPath = teledosiBackupAbsolutePath(fileName);
  const conn = await connectSsh2(options);
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) {
        conn.end();
        reject(err);
        return;
      }

      const stream = sftp.createReadStream(absPath);
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          stream.destroy();
        } catch {
          /* ignore */
        }
        try {
          conn.end();
        } catch {
          /* ignore */
        }
      };

      stream.once("close", () => {
        if (closed) return;
        closed = true;
        try {
          conn.end();
        } catch {
          /* ignore */
        }
      });
      stream.once("error", () => {
        if (closed) return;
        closed = true;
        try {
          conn.end();
        } catch {
          /* ignore */
        }
      });

      resolve({ stream, close });
    });
  });
}

export async function teledosiBackupDownloadToLocal(fileName: string, localPath: string): Promise<void> {
  await teledosiBackupDownloadToLocalWithProgress(fileName, localPath);
}

export async function teledosiBackupDownloadToLocalWithProgress(
  fileName: string,
  localPath: string,
  onProgress?: (downloadedBytes: number, totalBytes?: number) => void,
  shouldAbort?: () => boolean,
): Promise<void> {
  const options = getTeledosiFilesSshOptions();
  const absPath = teledosiBackupAbsolutePath(fileName);
  await mkdir(dirname(localPath), { recursive: true });
  const conn = await connectSsh2(options);
  try {
    await new Promise<void>((resolve, reject) => {
      conn.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return;
        }
        let aborted = false;

        void (async () => {
          const remoteStat = await new Promise<{ size?: number }>((statResolve, statReject) => {
            sftp.stat(absPath, (statErr, attrs) => {
              if (statErr) {
                statReject(statErr);
                return;
              }
              statResolve(attrs ?? {});
            });
          });
          const totalBytes =
            typeof remoteStat.size === "number" && Number.isFinite(remoteStat.size)
              ? remoteStat.size
              : undefined;

          const readStream = sftp.createReadStream(absPath);
          const writeStream = createWriteStream(localPath);
          onProgress?.(writeStream.bytesWritten, totalBytes);

          const poll = setInterval(() => {
            onProgress?.(writeStream.bytesWritten, totalBytes);
            if (shouldAbort?.() && !aborted) {
              aborted = true;
              const cancelError = new TeledosiBackupCancelledError();
              readStream.destroy(cancelError);
              writeStream.destroy(cancelError);
            }
          }, 500);

          try {
            await pipeline(readStream, writeStream);
            clearInterval(poll);
            const localStat = await stat(localPath);
            const localSize = localStat.size;
            onProgress?.(localSize, totalBytes);
            if (
              typeof totalBytes === "number" &&
              Number.isFinite(totalBytes) &&
              localSize !== totalBytes
            ) {
              throw new TeledosiBackupSizeMismatchError(totalBytes, localSize);
            }
            resolve();
          } catch (error) {
            clearInterval(poll);
            const currentWritten = writeStream.bytesWritten;
            onProgress?.(currentWritten, totalBytes);
            reject(error);
          }
        })().catch(reject);
      });
    });
  } finally {
    conn.end();
  }
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
