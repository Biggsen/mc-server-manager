import Database from "better-sqlite3";
import type { Database as Db } from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { getDataRoot } from "../config";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS log_imports (
  id INTEGER PRIMARY KEY,
  server_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  log_date TEXT NOT NULL,
  size_bytes INTEGER,
  imported_at TEXT NOT NULL,
  event_count INTEGER NOT NULL,
  UNIQUE(server_id, file_name)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  import_id INTEGER NOT NULL REFERENCES log_imports(id) ON DELETE CASCADE,
  server_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,
  entity TEXT,
  player TEXT,
  uuid TEXT,
  region TEXT,
  diff INTEGER,
  line_no INTEGER NOT NULL,
  raw_line TEXT NOT NULL,
  data_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_lookup ON events(server_id, type, entity, ts);
CREATE INDEX IF NOT EXISTS idx_events_player ON events(server_id, player, ts);
CREATE INDEX IF NOT EXISTS idx_events_import_line ON events(import_id, line_no);

CREATE TABLE IF NOT EXISTS event_counters (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_counters_lookup ON event_counters(name, event_id);
`;

let cachedDb: Db | null = null;
let cachedPath: string | null = null;

function defaultDbPath(): string {
  return join(getDataRoot(), "data", "metrics.db");
}

/**
 * Returns a singleton metrics database. The DB file is created if missing,
 * and the schema is brought up to date on first open.
 */
export function getMetricsDb(): Db {
  if (cachedDb) return cachedDb;
  const path = defaultDbPath();
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  cachedDb = db;
  cachedPath = path;
  return db;
}

/**
 * Test-only: open a fresh in-memory DB so unit tests don't leak state.
 */
export function createInMemoryMetricsDb(): Db {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  return db;
}

/**
 * Test-only / shutdown: close and clear the cached connection. The next call
 * to {@link getMetricsDb} reopens fresh from disk.
 */
export function closeMetricsDb(): void {
  if (cachedDb) {
    cachedDb.close();
    cachedDb = null;
    cachedPath = null;
  }
}

/** Diagnostic helper for routes/logs to report current DB location. */
export function getMetricsDbPath(): string {
  return cachedPath ?? defaultDbPath();
}
