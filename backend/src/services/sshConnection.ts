import { Client } from "ssh2";

export interface SshConnectOptions {
  host: string;
  port?: number;
  username: string;
  /** Used when not using a private key */
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

const SSH_ALGORITHMS = {
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
} as const;

export function normalizeSshHost(host: string): string {
  let h = host.trim();
  const sftpPrefix = "sftp://";
  if (h.toLowerCase().startsWith(sftpPrefix)) {
    h = h.slice(sftpPrefix.length);
  }
  const slash = h.indexOf("/");
  if (slash !== -1) h = h.slice(0, slash);
  return h;
}

/**
 * Open one ssh2 session. Caller must `conn.end()` when done.
 */
export function connectSsh2(options: SshConnectOptions): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const host = normalizeSshHost(options.host);
    const port = options.port ?? 22;
    const password = options.password ?? "";
    const opts: Record<string, unknown> = {
      host,
      port,
      username: options.username,
      tryKeyboard: true,
      readyTimeout: 20000,
      algorithms: SSH_ALGORITHMS,
    };

    if (options.privateKey) {
      opts.privateKey = options.privateKey;
      if (options.passphrase) {
        opts.passphrase = options.passphrase;
      }
    } else {
      opts.password = password;
      opts.keyboardInteractive = (
        _name: string,
        _inst: string,
        _lang: string,
        prompts: Array<{ prompt: string; echo: boolean }>,
        finish: (responses: string[]) => void,
      ) => {
        finish(prompts.map(() => password));
      };
    }

    if (process.env.DEBUG_SFTP === "1" || process.env.DEBUG_SFTP === "true") {
      opts.debug = (msg: string) => console.log("[ssh2]", msg);
    }

    conn.on("ready", () => resolve(conn));
    conn.on("error", reject);
    conn.connect(opts as Parameters<Client["connect"]>[0]);
  });
}
