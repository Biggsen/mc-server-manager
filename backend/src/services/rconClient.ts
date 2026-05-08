import type { LiveServerConfig } from "../config";
import {
  isLiveServerRconConfigured,
  liveServerRconNotConfiguredMessage,
  teledosiConfig,
} from "../config";
import { execBuffered, shellSingleQuote, withLiveServerSsh } from "./liveServerRemote";

export class LiveServerRconError extends Error {
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

/** @deprecated Use LiveServerRconError */
export const TeledosiRconError = LiveServerRconError;

const ANSI_ESCAPE_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, "");
}

async function executeViaSshWrapper(
  cfg: LiveServerConfig,
  command: string,
): Promise<{ response: string }> {
  const wrapperBin = shellSingleQuote(cfg.rcon.wrapperBin);
  const cmd = shellSingleQuote(command);
  const remoteCmd = `${wrapperBin} ${cmd} 2>&1`;
  const timeoutMs = cfg.rcon.timeoutMs;

  const result = await Promise.race([
    withLiveServerSsh(cfg, (conn) => execBuffered(conn, remoteCmd)),
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        reject(
          new LiveServerRconError(
            "TIMEOUT",
            `RCON request timed out after ${timeoutMs} ms`,
          ),
        );
      }, timeoutMs);
    }),
  ]);

  const rawOut = `${result.stdout}${result.stderr ? (result.stdout ? "\n" : "") + result.stderr : ""}`.trim();
  const out = stripAnsi(rawOut).trim();
  const msg = out.toLowerCase();
  if (result.code === 127 || /command not found|not recognized/.test(msg)) {
    throw new LiveServerRconError(
      "BINARY_MISSING",
      `RCON wrapper binary not found on remote host (tried ${cfg.rcon.wrapperBin}). Set ${cfg.envPrefix}_RCON_WRAPPER_BIN or install the wrapper on the VPS.`,
    );
  }
  if (/connection timed out|timed out/.test(msg)) {
    throw new LiveServerRconError("TIMEOUT", `RCON request timed out after ${timeoutMs} ms`);
  }
  if (/authentication failed|login failed|wrong password/.test(msg)) {
    throw new LiveServerRconError("AUTH_FAILED", "RCON authentication failed");
  }
  if (result.code !== 0) {
    throw new LiveServerRconError("SSH", out || `Remote wrapper exited with status ${result.code}`);
  }
  return { response: out };
}

export async function executeRconCommand(
  cfg: LiveServerConfig,
  command: string,
): Promise<{ response: string }> {
  if (!isLiveServerRconConfigured(cfg)) {
    throw new LiveServerRconError("NOT_CONFIGURED", liveServerRconNotConfiguredMessage(cfg));
  }
  const trimmed = command.trim();
  if (!trimmed) {
    throw new LiveServerRconError("PROTOCOL", "Command cannot be empty.");
  }
  return executeViaSshWrapper(cfg, trimmed).catch((error) => {
    throw normalizeRconError(error);
  });
}

export async function executeTeledosiRconCommand(
  command: string,
): Promise<{ response: string }> {
  return executeRconCommand(teledosiConfig, command);
}

function normalizeRconError(error: unknown): LiveServerRconError {
  if (error instanceof LiveServerRconError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new LiveServerRconError("NETWORK", `RCON transport error: ${message}`);
}
