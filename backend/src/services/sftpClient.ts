import { Client } from "ssh2";
import type { ProjectSftpConfig } from "../types/storage";

export interface SftpListEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  mtime?: string;
}

const REMOTE_PEEK_BYTES = 8192;

function sortEntries<T extends { name: string; type: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

function normalizeHost(host: string): string {
  let h = host.trim();
  const sftpPrefix = "sftp://";
  if (h.toLowerCase().startsWith(sftpPrefix)) {
    h = h.slice(sftpPrefix.length);
  }
  const slash = h.indexOf("/");
  if (slash !== -1) h = h.slice(0, slash);
  return h;
}

function connectClient(config: ProjectSftpConfig, password: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const host = normalizeHost(config.host);
    const port = config.port ?? 22;
    const opts: Record<string, unknown> = {
      host,
      port,
      username: config.username,
      password,
      tryKeyboard: true,
      readyTimeout: 20000,
      keyboardInteractive: (
        _name: string,
        _inst: string,
        _lang: string,
        prompts: Array<{ prompt: string; echo: boolean }>,
        finish: (responses: string[]) => void,
      ) => {
        finish(prompts.map(() => password));
      },
    };
    if (process.env.DEBUG_SFTP === "1" || process.env.DEBUG_SFTP === "true") {
      opts.debug = (msg: string) => console.log("[ssh2]", msg);
    }
    opts.algorithms = {
      kex: [
        "ecdh-sha2-nistp256",
        "ecdh-sha2-nistp384",
        "ecdh-sha2-nistp521",
        "diffie-hellman-group-exchange-sha256",
        "diffie-hellman-group14-sha256",
        "diffie-hellman-group14-sha1",
      ],
      cipher: [
        "aes128-ctr",
        "aes192-ctr",
        "aes256-ctr",
        "aes128-gcm",
        "aes256-gcm",
        "aes128-gcm@openssh.com",
        "aes256-gcm@openssh.com",
      ],
      serverHostKey: [
        "ssh-ed25519",
        "ssh-rsa",
        "ecdsa-sha2-nistp256",
        "ecdsa-sha2-nistp384",
        "ecdsa-sha2-nistp521",
      ],
    };
    conn.on("ready", () => resolve(conn));
    conn.on("error", reject);
    conn.connect(opts as Parameters<Client["connect"]>[0]);
  });
}

function sftpReadDir(conn: Client, path: string): Promise<SftpListEntry[]> {
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

function sftpUnlink(conn: Client, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) {
        reject(err);
        return;
      }
      sftp.unlink(remotePath, (unlinkErr) => {
        if (unlinkErr) reject(unlinkErr);
        else resolve();
      });
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

export async function listRemote(
  config: ProjectSftpConfig,
  password: string,
  path: string,
): Promise<SftpListEntry[]> {
  const dirPath = path || config.remotePath;
  return withSftp(config, password, (conn) => sftpReadDir(conn, dirPath));
}

export async function uploadFile(
  config: ProjectSftpConfig,
  password: string,
  localPath: string,
  remotePath: string,
): Promise<void> {
  return withSftp(config, password, (conn) => sftpFastPut(conn, localPath, remotePath));
}

export async function deleteRemoteFile(
  config: ProjectSftpConfig,
  password: string,
  path: string,
): Promise<void> {
  const root = (config.remotePath ?? "").replace(/\/+$/, "").trim();
  const normalized = path.replace(/\/+$/, "").trim() || "/";
  const remoteForSftp =
    root && (normalized === root || normalized.startsWith(root + "/"))
      ? normalized.slice(root.length).replace(/^\/+/, "")
      : path;
  return withSftp(config, password, (conn) => sftpUnlink(conn, remoteForSftp));
}

export async function downloadRemoteFile(
  config: ProjectSftpConfig,
  password: string,
  remotePath: string,
  localPath: string,
): Promise<void> {
  const root = (config.remotePath ?? "").replace(/\/+$/, "").trim();
  const normalized = remotePath.replace(/\/+$/, "").trim() || "/";
  const remoteForSftp =
    root && (normalized === root || normalized.startsWith(root + "/"))
      ? normalized.slice(root.length).replace(/^\/+/, "")
      : remotePath;
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
  const root = (config.remotePath ?? "").replace(/\/+$/, "").trim();
  const normalized = remotePath.replace(/\/+$/, "").trim() || "/";
  const remoteForSftp =
    root && (normalized === root || normalized.startsWith(root + "/"))
      ? normalized.slice(root.length).replace(/^\/+/, "") || "."
      : remotePath;
  const bytes = await withSftp(config, password, (conn) =>
    sftpReadFileHead(conn, remoteForSftp, REMOTE_PEEK_BYTES),
  );
  return parseGeneratorVersionFromHeader(bytes.toString("utf8"));
}
