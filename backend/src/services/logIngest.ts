import { createGunzip } from "zlib";
import { createInterface } from "readline";
import { pipeline } from "stream";
import type { Database as Db } from "better-sqlite3";
import type { LiveServerConfig } from "../config";
import { isLiveServerFilesConfigured } from "../config";
import { getMetricsDb } from "./metricsDb";
import { getLiveServerFilesSshOptions, liveServerAbsoluteFromRelative } from "./liveServerFiles";
import { sftpCreateReadStream, sftpStat, withSftpConnection } from "./sftpClient";

export const GZ_FILE_NAME_RE = /^(\d{4})-(\d{2})-(\d{2})-(\d+)\.log\.gz$/;
const EXPMETRIC_TAG = "[EXPMETRIC]";
const DAY_FILE_NAME_RE = /^(\d{4})-(\d{2})-(\d{2})-\d+\.log\.gz$/;

/**
 * One parsed `[EXPMETRIC]` line. `data` carries every key=value pair,
 * including ones that already have a dedicated column, so the original record
 * is fully preserved for debugging / future fields.
 */
export interface ParsedExpmetricEvent {
  ts: string;
  type: string;
  entity: string | null;
  player: string | null;
  uuid: string | null;
  region: string | null;
  diff: number | null;
  lineNo: number;
  rawLine: string;
  data: Record<string, string>;
  /** Numeric counters extracted from `data`, excluding `diff` (kept on the column). */
  counters: Array<{ name: string; value: number }>;
}

/**
 * The standard "shape" fields covered by their own columns. Any other numeric
 * value in `data` is exploded into `event_counters`.
 */
const SHAPE_KEYS = new Set([
  "server",
  "type",
  "entity",
  "player",
  "uuid",
  "region",
  "diff",
]);

const KV_REGEX = /(\w+)=((?:(?!\s+\w+=).)+)/g;

/**
 * Build an ISO timestamp from the date carried by the filename and the
 * `[HH:MM:SS]` prefix on the line. Returned as `YYYY-MM-DDTHH:MM:SS` so
 * SQLite ordering by `ts` is correct.
 */
function buildTimestamp(dateFromFilename: string, hms: string): string {
  return `${dateFromFilename}T${hms}`;
}

/**
 * Parse one log line. Returns null for non-EXPMETRIC lines, malformed lines,
 * or lines we can't extract a timestamp from. Throws nothing.
 *
 * @param line raw line, no trailing newline
 * @param lineNo 1-based line number within the source file
 * @param dateFromFilename `YYYY-MM-DD` derived from the filename
 */
export function parseExpmetricLine(
  line: string,
  lineNo: number,
  dateFromFilename: string,
): ParsedExpmetricEvent | null {
  if (!line || !line.includes(EXPMETRIC_TAG)) return null;

  const tsMatch = /^\[(\d{2}:\d{2}:\d{2})\]/.exec(line);
  if (!tsMatch) return null;
  const hms = tsMatch[1];

  const tagIdx = line.indexOf(EXPMETRIC_TAG);
  if (tagIdx < 0) return null;
  const payload = line.slice(tagIdx + EXPMETRIC_TAG.length).trim();
  if (!payload) return null;

  const data: Record<string, string> = {};
  KV_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = KV_REGEX.exec(payload)) !== null) {
    const key = match[1];
    const value = match[2].trimEnd();
    if (key && value) {
      data[key] = value;
    }
  }

  const type = data.type;
  if (!type) return null;

  const counters: Array<{ name: string; value: number }> = [];
  for (const [k, v] of Object.entries(data)) {
    if (SHAPE_KEYS.has(k)) continue;
    const n = Number(v);
    if (Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(v)) {
      counters.push({ name: k, value: Math.trunc(n) });
    }
  }

  const diffValue =
    data.diff !== undefined && /^-?\d+$/.test(data.diff) ? Number(data.diff) : null;

  return {
    ts: buildTimestamp(dateFromFilename, hms),
    type,
    entity: data.entity ?? null,
    player: data.player ?? null,
    uuid: data.uuid ?? null,
    region: data.region ?? null,
    diff: diffValue,
    lineNo,
    rawLine: line,
    data,
    counters,
  };
}

/**
 * Extract `YYYY-MM-DD` from a `YYYY-MM-DD-N.log.gz` filename.
 * Returns null if the name doesn't match the expected pattern.
 */
export function dateFromGzFileName(fileName: string): string | null {
  const m = DAY_FILE_NAME_RE.exec(fileName);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * Read a gunzipped stream line-by-line, returning every successfully parsed
 * EXPMETRIC event. Pure parsing — no DB writes here.
 *
 * Uses `stream.pipeline` (callback form) so error events on the source stream
 * are forwarded to the gunzip stream, both ends are destroyed cleanly on
 * error or completion, and a stray late SFTP error can't escape as an
 * uncaught `'error'` event.
 */
export async function parseGzStream(
  stream: NodeJS.ReadableStream,
  dateFromFilename: string,
): Promise<{ events: ParsedExpmetricEvent[]; totalLines: number }> {
  const gunzip = createGunzip();
  pipeline(stream, gunzip, () => {
    /* errors surface to the readline consumer below via gunzip; the
       callback only exists to attach error handlers on both streams. */
  });
  const rl = createInterface({ input: gunzip, crlfDelay: Infinity });
  const events: ParsedExpmetricEvent[] = [];
  let lineNo = 0;
  for await (const line of rl) {
    lineNo += 1;
    const parsed = parseExpmetricLine(line, lineNo, dateFromFilename);
    if (parsed) events.push(parsed);
  }
  return { events, totalLines: lineNo };
}

export interface IngestResult {
  fileName: string;
  importId: number;
  eventCount: number;
  totalLines: number;
  durationMs: number;
}

export class LogIngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LogIngestError";
  }
}

/**
 * Persist a freshly parsed import inside one transaction. Old data for the
 * same `(server_id, file_name)` is removed only after the new payload is
 * known good, so a parse failure can never wipe a previous good import.
 */
export function persistImport(
  db: Db,
  serverId: string,
  fileName: string,
  logDate: string,
  sizeBytes: number | null,
  events: ParsedExpmetricEvent[],
): { importId: number; eventCount: number } {
  const importedAt = new Date().toISOString();

  const txn = db.transaction(() => {
    db.prepare(`DELETE FROM log_imports WHERE server_id = ? AND file_name = ?`).run(
      serverId,
      fileName,
    );

    const importInsert = db
      .prepare(
        `INSERT INTO log_imports (server_id, file_name, log_date, size_bytes, imported_at, event_count)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(serverId, fileName, logDate, sizeBytes, importedAt, events.length);

    const importId = Number(importInsert.lastInsertRowid);

    const eventInsert = db.prepare(
      `INSERT INTO events
        (import_id, server_id, ts, type, entity, player, uuid, region, diff, line_no, raw_line, data_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const counterInsert = db.prepare(
      `INSERT INTO event_counters (event_id, name, value) VALUES (?, ?, ?)`,
    );

    for (const ev of events) {
      const result = eventInsert.run(
        importId,
        serverId,
        ev.ts,
        ev.type,
        ev.entity,
        ev.player,
        ev.uuid,
        ev.region,
        ev.diff,
        ev.lineNo,
        ev.rawLine,
        JSON.stringify(ev.data),
      );
      const eventId = Number(result.lastInsertRowid);
      for (const c of ev.counters) {
        counterInsert.run(eventId, c.name, c.value);
      }
    }

    return importId;
  });

  const importId = txn();
  return { importId, eventCount: events.length };
}

/**
 * Full ingest pipeline for one remote `.log.gz`: validate name, SFTP-stream,
 * gunzip, parse, then persist atomically.
 *
 * The `latest.log` file is rejected up-front; only `*.log.gz` matching
 * `YYYY-MM-DD-N.log.gz` is accepted.
 */
export async function ingestRemoteGzLog(
  cfg: LiveServerConfig,
  fileName: string,
): Promise<IngestResult> {
  if (!GZ_FILE_NAME_RE.test(fileName)) {
    throw new LogIngestError(
      `Refusing to ingest "${fileName}": only finalised YYYY-MM-DD-N.log.gz files are importable`,
    );
  }
  if (!isLiveServerFilesConfigured(cfg)) {
    throw new LogIngestError(`Live server "${cfg.id}" remote files are not configured`);
  }

  const logDate = dateFromGzFileName(fileName);
  if (!logDate) {
    throw new LogIngestError(`Cannot derive a date from "${fileName}"`);
  }

  const startedAt = Date.now();
  const remotePath = liveServerAbsoluteFromRelative(cfg, `logs/${fileName}`);
  const options = getLiveServerFilesSshOptions(cfg);

  const { events, totalLines, sizeBytes } = await withSftpConnection(options, async (conn) => {
    const stat = await sftpStat(conn, remotePath);
    const stream = await sftpCreateReadStream(conn, remotePath);
    const parsed = await parseGzStream(stream, logDate);
    return { ...parsed, sizeBytes: stat?.size ?? null };
  });

  const db = getMetricsDb();
  const { importId, eventCount } = persistImport(
    db,
    cfg.id,
    fileName,
    logDate,
    sizeBytes,
    events,
  );

  return {
    fileName,
    importId,
    eventCount,
    totalLines,
    durationMs: Date.now() - startedAt,
  };
}
