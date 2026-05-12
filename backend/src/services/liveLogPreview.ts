import type { LiveServerConfig } from "../config";
import { isLiveServerFilesConfigured } from "../config";
import {
  getLiveServerFilesSshOptions,
  liveServerAbsoluteFromRelative,
} from "./liveServerFiles";
import { parseExpmetricLine, type ParsedExpmetricEvent } from "./logIngest";
import { sftpReadFullFile, sftpStat, withSftpConnection } from "./sftpClient";

const DEFAULT_TAIL_CAP_BYTES = 32 * 1024 * 1024;

export interface LivePreview {
  fileName: string;
  fileSize: number | null;
  fetchedBytes: number;
  truncated: boolean;
  fetchedAt: string;
  date: string;
  events: ParsedExpmetricEvent[];
  summary: {
    totalLines: number;
    expmetricCount: number;
    joins: number;
    leaves: number;
    discoveries: number;
    uniquePlayers: number;
    currentlyOnline: Array<{ player: string; uuid: string; since: string }>;
  };
}

function todayLocalDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function summarise(events: ParsedExpmetricEvent[]): LivePreview["summary"] {
  let joins = 0;
  let leaves = 0;
  let discoveries = 0;
  const uuids = new Set<string>();
  // Last seen join/leave per uuid → currently online if last is join
  const lastByUuid = new Map<string, ParsedExpmetricEvent>();

  for (const ev of events) {
    if (ev.type === "join") joins += 1;
    else if (ev.type === "leave") leaves += 1;
    else if (ev.type === "discovery") discoveries += 1;
    if (ev.uuid) uuids.add(ev.uuid);
    if ((ev.type === "join" || ev.type === "leave") && ev.uuid) {
      const prev = lastByUuid.get(ev.uuid);
      if (!prev || prev.ts <= ev.ts) lastByUuid.set(ev.uuid, ev);
    }
  }

  const online: Array<{ player: string; uuid: string; since: string }> = [];
  for (const [uuid, ev] of lastByUuid.entries()) {
    if (ev.type === "join" && ev.player) {
      online.push({ player: ev.player, uuid, since: ev.ts });
    }
  }
  online.sort((a, b) => a.player.localeCompare(b.player));

  return {
    totalLines: events.length,
    expmetricCount: events.length,
    joins,
    leaves,
    discoveries,
    uniquePlayers: uuids.size,
    currentlyOnline: online,
  };
}

/**
 * Read `latest.log` (or a tail of it) from the live server, parse every
 * `[EXPMETRIC]` line in memory, and return a transient preview. No data is
 * written to the metrics DB — this is read-only and safe to call frequently.
 */
export async function readLatestLogPreview(
  cfg: LiveServerConfig,
  cap = DEFAULT_TAIL_CAP_BYTES,
): Promise<LivePreview> {
  if (!isLiveServerFilesConfigured(cfg)) {
    throw new Error(`Live server "${cfg.id}" remote files are not configured`);
  }

  const remotePath = liveServerAbsoluteFromRelative(cfg, "logs/latest.log");
  const options = getLiveServerFilesSshOptions(cfg);
  const date = todayLocalDate();

  const { buffer, fileSize, truncated } = await withSftpConnection(options, async (conn) => {
    const stat = await sftpStat(conn, remotePath);
    if (stat === null) {
      return { buffer: Buffer.alloc(0), fileSize: 0, truncated: false };
    }
    const { buffer: buf, truncated: tr } = await sftpReadFullFile(conn, remotePath, cap);
    return { buffer: buf, fileSize: stat.size, truncated: tr };
  });

  let text = buffer.toString("utf8");
  // If we tailed, the first line might be a partial — drop it.
  if (truncated) {
    const idx = text.indexOf("\n");
    if (idx >= 0) text = text.slice(idx + 1);
  }

  const lines = text.split(/\r?\n/);
  const events: ParsedExpmetricEvent[] = [];
  let lineNo = 0;
  for (const line of lines) {
    lineNo += 1;
    const ev = parseExpmetricLine(line, lineNo, date);
    if (ev) events.push(ev);
  }

  return {
    fileName: "latest.log",
    fileSize,
    fetchedBytes: buffer.length,
    truncated,
    fetchedAt: new Date().toISOString(),
    date,
    events,
    summary: summarise(events),
  };
}
