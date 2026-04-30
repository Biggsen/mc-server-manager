import {
  TELEDOSI_RCON_NOT_CONFIGURED_MESSAGE,
  isTeledosiRconConfigured,
  teledosiMcrconBin,
  teledosiRconHost,
  teledosiRconPassword,
  teledosiRconPort,
  teledosiRconTimeoutMs,
} from "../config";
import { execBuffered, shellSingleQuote, withTeledosiSsh } from "./teledosiRemote";

export class TeledosiRconError extends Error {
  code:
    | "NOT_CONFIGURED"
    | "AUTH_FAILED"
    | "TIMEOUT"
    | "NETWORK"
    | "PROTOCOL"
    | "BINARY_MISSING"
    | "SSH";

  constructor(
    code:
      | "NOT_CONFIGURED"
      | "AUTH_FAILED"
      | "TIMEOUT"
      | "NETWORK"
      | "PROTOCOL"
      | "BINARY_MISSING"
      | "SSH",
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}

const ANSI_ESCAPE_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, "");
}

async function executeViaSshMcrcon(
  command: string,
): Promise<{ response: string }> {
  const host = shellSingleQuote(teledosiRconHost);
  const port = shellSingleQuote(String(teledosiRconPort));
  const password = shellSingleQuote(teledosiRconPassword);
  const cmd = shellSingleQuote(command);
  const bin = shellSingleQuote(teledosiMcrconBin);
  const remoteCmd = `${bin} -H ${host} -P ${port} -p ${password} ${cmd} 2>&1`;

  const result = await Promise.race([
    withTeledosiSsh((conn) => execBuffered(conn, remoteCmd)),
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        reject(
          new TeledosiRconError(
            "TIMEOUT",
            `RCON request timed out after ${teledosiRconTimeoutMs} ms`,
          ),
        );
      }, teledosiRconTimeoutMs);
    }),
  ]);

  const rawOut = `${result.stdout}${result.stderr ? (result.stdout ? "\n" : "") + result.stderr : ""}`.trim();
  const out = stripAnsi(rawOut).trim();
  const msg = out.toLowerCase();
  if (result.code === 127 || /command not found|not recognized/.test(msg)) {
    throw new TeledosiRconError(
      "BINARY_MISSING",
      `mcrcon binary not found on remote host (tried ${teledosiMcrconBin}). Set TELEDOSI_MCRCON_BIN or install mcrcon on the VPS.`,
    );
  }
  if (/connection timed out|timed out/.test(msg)) {
    throw new TeledosiRconError("TIMEOUT", `RCON request timed out after ${teledosiRconTimeoutMs} ms`);
  }
  if (/authentication failed|login failed|wrong password/.test(msg)) {
    throw new TeledosiRconError("AUTH_FAILED", "RCON authentication failed");
  }
  if (result.code !== 0) {
    throw new TeledosiRconError("SSH", out || `Remote mcrcon exited with status ${result.code}`);
  }
  return { response: out };
}

export async function executeTeledosiRconCommand(
  command: string,
): Promise<{ response: string }> {
  if (!isTeledosiRconConfigured()) {
    throw new TeledosiRconError("NOT_CONFIGURED", TELEDOSI_RCON_NOT_CONFIGURED_MESSAGE);
  }
  const trimmed = command.trim();
  if (!trimmed) {
    throw new TeledosiRconError("PROTOCOL", "Command cannot be empty.");
  }
  return executeViaSshMcrcon(trimmed).catch((error) => {
    throw normalizeRconError(error);
  });
}

function normalizeRconError(error: unknown): TeledosiRconError {
  if (error instanceof TeledosiRconError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new TeledosiRconError("NETWORK", `RCON transport error: ${message}`);
}
