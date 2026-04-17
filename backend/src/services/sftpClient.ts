import { Client } from "ssh2";
import type { SFTPWrapper } from "ssh2";
import type { ProjectSftpConfig } from "../types/storage";
import { connectSsh2, type SshConnectOptions } from "./sshConnection";

export interface SftpListEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  mtime?: string;
}

const REMOTE_PEEK_BYTES = 8192;

function normalizeRemoteRoot(path: string | undefined): string {
  const normalized = (path ?? "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return "";
  return normalized.startsWith("/") ? normalized : `/${normalized.replace(/^\/+/, "")}`;
}

function resolveRemotePath(config: ProjectSftpConfig, inputPath: string): string {
  const root = normalizeRemoteRoot(config.remotePath);
  const raw = inputPath.trim().replace(/\\/g, "/");
  if (!raw || raw === ".") {
    return root || ".";
  }
  if (raw.startsWith("/")) {
    return raw.replace(/\/+$/, "") || "/";
  }
  const relative = raw.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!relative) return root || ".";
  if (!root) return relative;
  return `${root}/${relative}`;
}

function sortEntries<T extends { name: string; type: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

function connectClient(config: ProjectSftpConfig, password: string): Promise<Client> {
  return connectSsh2({
    host: config.host,
    port: config.port,
    username: config.username,
    password,
  });
}

export function sftpReadDir(conn: Client, path: string): Promise<SftpListEntry[]> {
  const normalized = path.trim().replace(/\/+$/, "") || "/";
  const readdirPath = normalized;
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) {
        reject(err);
        return;
      }
      sftp.readdir(readdirPath, (readErr, list) => {
        if (readErr) {
          reject(readErr);
          return;
        }
        const base = normalized;
        const entries: SftpListEntry[] = (list ?? []).map((item) => {
          const filename = typeof item.filename === "string" ? item.filename : String(item.filename);
          const isDir = (item.attrs?.mode ?? 0) & 0o040000;
          const fullPath = base === "/" ? `/${filename}` : `${base}/${filename}`;
          const mtime =
            typeof item.attrs?.mtime === "number"
              ? new Date(item.attrs.mtime * 1000).toISOString()
              : undefined;
          return {
            name: filename,
            path: fullPath,
            type: isDir ? "directory" : "file",
            size: item.attrs?.size,
            mtime,
          };
        });
        resolve(sortEntries(entries));
      });
    });
  });
}

function sftpFastPut(conn: Client, localPath: string, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) {
        reject(err);
        return;
      }
      sftp.fastPut(localPath, remotePath, (putErr) => {
        if (putErr) reject(putErr);
        else resolve();
      });
    });
  });
}

function sftpFastGet(conn: Client, remotePath: string, localPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) {
        reject(err);
        return;
      }
      sftp.fastGet(remotePath, localPath, (getErr) => {
        if (getErr) reject(getErr);
        else resolve();
      });
    });
  });
}

function sftpRemoveRecursiveSftp(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.unlink(remotePath, (unlinkErr) => {
      if (!unlinkErr) {
        resolve();
        return;
      }
      sftp.readdir(remotePath, (readErr, list) => {
        if (readErr) {
          reject(unlinkErr);
          return;
        }
        const names = (list ?? []).map((item) =>
          typeof item.filename === "string" ? item.filename : String(item.filename),
        );
        const base = remotePath.replace(/\/+$/, "") || "/";
        const childPaths = names.map((name) => (base === "/" ? `/${name}` : `${base}/${name}`));
        (async () => {
          for (const child of childPaths) {
            await sftpRemoveRecursiveSftp(sftp, child);
          }
          await new Promise<void>((res, rej) => {
            sftp.rmdir(remotePath, (rmdirErr) => {
              if (rmdirErr) rej(rmdirErr);
              else res();
            });
          });
          resolve();
        })().catch(reject);
      });
    });
  });
}

function sftpRemovePath(conn: Client, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) {
        reject(err);
        return;
      }
      sftpRemoveRecursiveSftp(sftp, remotePath).then(resolve).catch(reject);
    });
  });
}

function sftpReadFileHead(conn: Client, remotePath: string, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) {
        reject(err);
        return;
      }
      sftp.open(remotePath, "r", (openErr, handle) => {
        if (openErr) {
          reject(openErr);
          return;
        }
        const buffer = Buffer.alloc(maxBytes);
        sftp.read(handle, buffer, 0, maxBytes, 0, (readErr, bytesRead) => {
          sftp.close(handle, () => {});
          if (readErr) {
            reject(readErr);
            return;
          }
          resolve(buffer.subarray(0, bytesRead));
        });
      });
    });
  });
}

export async function withSftpConnection<T>(
  options: SshConnectOptions,
  fn: (conn: Client) => Promise<T>,
): Promise<T> {
  const conn = await connectSsh2(options);
  try {
    return await fn(conn);
  } finally {
    conn.end();
  }
}

export async function withSftp<T>(
  config: ProjectSftpConfig,
  password: string,
  fn: (conn: Client) => Promise<T>,
): Promise<T> {
  const conn = await connectClient(config, password);
  try {
    return await fn(conn);
  } finally {
    conn.end();
  }
}

/** Read entire remote file up to maxBytes (SFTP). */
export async function sftpReadFullFile(
  conn: Client,
  remotePath: string,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let position = 0;
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) {
        reject(err);
        return;
      }
      sftp.open(remotePath, "r", (openErr, handle) => {
        if (openErr) {
          reject(openErr);
          return;
        }
        const readNext = (): void => {
          const remaining = maxBytes - position;
          if (remaining <= 0) {
            sftp.close(handle, () => {
              resolve(Buffer.concat(chunks));
            });
            return;
          }
          const buf = Buffer.alloc(Math.min(65536, remaining));
          sftp.read(handle, buf, 0, buf.length, position, (readErr, bytesRead) => {
            if (readErr) {
              sftp.close(handle, () => {
                reject(readErr);
              });
              return;
            }
            if (!bytesRead) {
              sftp.close(handle, () => {
                resolve(Buffer.concat(chunks));
              });
              return;
            }
            chunks.push(buf.subarray(0, bytesRead));
            position += bytesRead;
            readNext();
          });
        };
        readNext();
      });
    });
  });
}

/** Replace remote file contents (SFTP). */
export async function sftpWriteFullFile(conn: Client, remotePath: string, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) {
        reject(err);
        return;
      }
      sftp.open(remotePath, "w", (openErr, handle) => {
        if (openErr) {
          reject(openErr);
          return;
        }
        let offset = 0;
        const writeNext = (): void => {
          if (offset >= data.length) {
            sftp.close(handle, (closeErr) => {
              if (closeErr) reject(closeErr);
              else resolve();
            });
            return;
          }
          const slice = data.subarray(offset, Math.min(offset + 65536, data.length));
          sftp.write(handle, slice, 0, slice.length, offset, (writeErr) => {
            if (writeErr) {
              sftp.close(handle, () => {
                reject(writeErr);
              });
              return;
            }
            offset += slice.length;
            writeNext();
          });
        };
        writeNext();
      });
    });
  });
}

export async function listRemote(
  config: ProjectSftpConfig,
  password: string,
  path: string,
): Promise<SftpListEntry[]> {
  const dirPath = resolveRemotePath(config, path || ".");
  return withSftp(config, password, (conn) => sftpReadDir(conn, dirPath));
}

export async function uploadFile(
  config: ProjectSftpConfig,
  password: string,
  localPath: string,
  remotePath: string,
): Promise<void> {
  const resolved = resolveRemotePath(config, remotePath);
  return withSftp(config, password, (conn) => sftpFastPut(conn, localPath, resolved));
}

export async function deleteRemoteFile(
  config: ProjectSftpConfig,
  password: string,
  path: string,
): Promise<void> {
  const resolved = resolveRemotePath(config, path);
  return withSftp(config, password, (conn) => sftpRemovePath(conn, resolved));
}

export async function downloadRemoteFile(
  config: ProjectSftpConfig,
  password: string,
  remotePath: string,
  localPath: string,
): Promise<void> {
  const remoteForSftp = resolveRemotePath(config, remotePath);
  return withSftp(config, password, (conn) =>
    sftpFastGet(conn, remoteForSftp, localPath),
  );
}

export function parseGeneratorVersionFromHeader(content: string): string | undefined {
  const match = content.match(/generator-version\s*=\s*([^;\s]+)/i);
  const raw = match?.[1]?.trim();
  return raw || undefined;
}

export async function readRemoteGeneratorVersion(
  config: ProjectSftpConfig,
  password: string,
  remotePath: string,
): Promise<string | undefined> {
  const remoteForSftp = resolveRemotePath(config, remotePath);
  const bytes = await withSftp(config, password, (conn) =>
    sftpReadFileHead(conn, remoteForSftp, REMOTE_PEEK_BYTES),
  );
  return parseGeneratorVersionFromHeader(bytes.toString("utf8"));
}
