import type { Database as Db } from "better-sqlite3";

export interface RangeResult {
  earliestTs: string | null;
  latestTs: string | null;
  totalEvents: number;
  totalImports: number;
  importedFiles: string[];
}

export function getRange(db: Db, serverId: string): RangeResult {
  const stats = db
    .prepare(
      `SELECT MIN(ts) AS earliest, MAX(ts) AS latest, COUNT(*) AS total
       FROM events WHERE server_id = ?`,
    )
    .get(serverId) as { earliest: string | null; latest: string | null; total: number };

  const importsRows = db
    .prepare(
      `SELECT file_name FROM log_imports WHERE server_id = ? ORDER BY file_name`,
    )
    .all(serverId) as Array<{ file_name: string }>;

  return {
    earliestTs: stats.earliest,
    latestTs: stats.latest,
    totalEvents: stats.total,
    totalImports: importsRows.length,
    importedFiles: importsRows.map((r) => r.file_name),
  };
}

export interface OverviewKpis {
  uniquePlayers: number;
  totalSessions: number;
  totalJoins: number;
  totalLeaves: number;
  totalDiscoveries: number;
  totalPlayMinutes: number;
  daysActive: number;
}

const SESSION_PAIRS_CTE = `
WITH ordered AS (
  SELECT
    server_id, player, uuid, ts, type,
    LEAD(ts) OVER (PARTITION BY server_id, uuid ORDER BY ts) AS next_ts,
    LEAD(type) OVER (PARTITION BY server_id, uuid ORDER BY ts) AS next_type
  FROM events
  WHERE server_id = ? AND type IN ('join', 'leave')
),
sessions AS (
  SELECT
    server_id, player, uuid, ts AS join_ts,
    CASE WHEN next_type = 'leave' THEN next_ts ELSE NULL END AS leave_ts
  FROM ordered
  WHERE type = 'join'
)
`;

export function getOverviewKpis(
  db: Db,
  serverId: string,
  fromTs: string,
  toTs: string,
): OverviewKpis {
  const distinctPlayers = db
    .prepare(
      `SELECT COUNT(DISTINCT uuid) AS c FROM events
       WHERE server_id = ? AND ts >= ? AND ts < ? AND uuid IS NOT NULL`,
    )
    .get(serverId, fromTs, toTs) as { c: number };

  const counts = db
    .prepare(
      `SELECT type, COUNT(*) AS c FROM events
       WHERE server_id = ? AND ts >= ? AND ts < ? GROUP BY type`,
    )
    .all(serverId, fromTs, toTs) as Array<{ type: string; c: number }>;
  const byType = new Map(counts.map((r) => [r.type, r.c]));

  const sessions = db
    .prepare(
      `${SESSION_PAIRS_CTE}
       SELECT
         COUNT(*) AS total_sessions,
         SUM(
           CASE
             WHEN leave_ts IS NULL THEN 0
             ELSE CAST((julianday(leave_ts) - julianday(join_ts)) * 24 * 60 AS INTEGER)
           END
         ) AS play_minutes
       FROM sessions
       WHERE join_ts >= ? AND join_ts < ?`,
    )
    .get(serverId, fromTs, toTs) as {
    total_sessions: number;
    play_minutes: number | null;
  };

  const days = db
    .prepare(
      `SELECT COUNT(DISTINCT substr(ts, 1, 10)) AS c FROM events
       WHERE server_id = ? AND ts >= ? AND ts < ?`,
    )
    .get(serverId, fromTs, toTs) as { c: number };

  return {
    uniquePlayers: distinctPlayers.c,
    totalSessions: sessions.total_sessions,
    totalJoins: byType.get("join") ?? 0,
    totalLeaves: byType.get("leave") ?? 0,
    totalDiscoveries: byType.get("discovery") ?? 0,
    totalPlayMinutes: sessions.play_minutes ?? 0,
    daysActive: days.c,
  };
}

export type ActivityBucket = "day" | "hour";

export interface ActivityRow {
  bucket: string;
  joins: number;
  leaves: number;
  discoveries: number;
  uniquePlayers: number;
}

export function getOverviewActivity(
  db: Db,
  serverId: string,
  fromTs: string,
  toTs: string,
  bucket: ActivityBucket,
): ActivityRow[] {
  const bucketExpr = bucket === "hour" ? "substr(ts, 1, 13)" : "substr(ts, 1, 10)";
  const rows = db
    .prepare(
      `SELECT ${bucketExpr} AS bucket,
              SUM(CASE WHEN type = 'join' THEN 1 ELSE 0 END) AS joins,
              SUM(CASE WHEN type = 'leave' THEN 1 ELSE 0 END) AS leaves,
              SUM(CASE WHEN type = 'discovery' THEN 1 ELSE 0 END) AS discoveries,
              COUNT(DISTINCT uuid) AS unique_players
       FROM events
       WHERE server_id = ? AND ts >= ? AND ts < ?
       GROUP BY bucket
       ORDER BY bucket`,
    )
    .all(serverId, fromTs, toTs) as Array<{
    bucket: string;
    joins: number;
    leaves: number;
    discoveries: number;
    unique_players: number;
  }>;

  return rows.map((r) => ({
    bucket: r.bucket,
    joins: r.joins,
    leaves: r.leaves,
    discoveries: r.discoveries,
    uniquePlayers: r.unique_players,
  }));
}

export interface PlayerRow {
  player: string;
  uuid: string;
  sessions: number;
  playMinutes: number;
  lastSeen: string;
  firstSeen: string;
  joins: number;
  discoveries: number;
  discoveriesByEntity: { region: number; structure: number; village: number; heart: number };
}

export function getOverviewPlayers(
  db: Db,
  serverId: string,
  fromTs: string,
  toTs: string,
): PlayerRow[] {
  const rows = db
    .prepare(
      `${SESSION_PAIRS_CTE}
       , session_stats AS (
         SELECT
           uuid,
           COUNT(*) AS sessions,
           SUM(
             CASE
               WHEN leave_ts IS NULL THEN 0
               ELSE CAST((julianday(leave_ts) - julianday(join_ts)) * 24 * 60 AS INTEGER)
             END
           ) AS play_minutes
         FROM sessions
         WHERE join_ts >= ? AND join_ts < ?
         GROUP BY uuid
       ),
       player_meta AS (
         SELECT
           uuid,
           MAX(player) AS player,
           MIN(ts) AS first_seen,
           MAX(ts) AS last_seen,
           SUM(CASE WHEN type = 'join' THEN 1 ELSE 0 END) AS joins,
           SUM(CASE WHEN type = 'discovery' THEN 1 ELSE 0 END) AS discoveries,
           SUM(CASE WHEN type = 'discovery' AND entity = 'region' THEN 1 ELSE 0 END) AS d_region,
           SUM(CASE WHEN type = 'discovery' AND entity = 'structure' THEN 1 ELSE 0 END) AS d_structure,
           SUM(CASE WHEN type = 'discovery' AND entity = 'village' THEN 1 ELSE 0 END) AS d_village,
           SUM(CASE WHEN type = 'discovery' AND entity = 'heart' THEN 1 ELSE 0 END) AS d_heart
         FROM events
         WHERE server_id = ? AND ts >= ? AND ts < ? AND uuid IS NOT NULL
         GROUP BY uuid
       )
       SELECT
         pm.uuid AS uuid,
         pm.player AS player,
         COALESCE(ss.sessions, 0) AS sessions,
         COALESCE(ss.play_minutes, 0) AS play_minutes,
         pm.first_seen,
         pm.last_seen,
         pm.joins,
         pm.discoveries,
         pm.d_region, pm.d_structure, pm.d_village, pm.d_heart
       FROM player_meta pm
       LEFT JOIN session_stats ss ON ss.uuid = pm.uuid
       ORDER BY pm.last_seen DESC`,
    )
    .all(serverId, fromTs, toTs, serverId, fromTs, toTs) as Array<{
    uuid: string;
    player: string;
    sessions: number;
    play_minutes: number;
    first_seen: string;
    last_seen: string;
    joins: number;
    discoveries: number;
    d_region: number;
    d_structure: number;
    d_village: number;
    d_heart: number;
  }>;

  return rows.map((r) => ({
    player: r.player,
    uuid: r.uuid,
    sessions: r.sessions,
    playMinutes: r.play_minutes ?? 0,
    firstSeen: r.first_seen,
    lastSeen: r.last_seen,
    joins: r.joins,
    discoveries: r.discoveries,
    discoveriesByEntity: {
      region: r.d_region,
      structure: r.d_structure,
      village: r.d_village,
      heart: r.d_heart,
    },
  }));
}

export interface DiscoveriesByEntityRow {
  entity: string;
  count: number;
}

export function getDiscoveriesByEntity(
  db: Db,
  serverId: string,
  fromTs: string,
  toTs: string,
): DiscoveriesByEntityRow[] {
  return db
    .prepare(
      `SELECT entity, COUNT(*) AS count FROM events
       WHERE server_id = ? AND ts >= ? AND ts < ? AND type = 'discovery' AND entity IS NOT NULL
       GROUP BY entity ORDER BY count DESC`,
    )
    .all(serverId, fromTs, toTs) as DiscoveriesByEntityRow[];
}

export interface TopRegionRow {
  region: string;
  discoveries: number;
  uniquePlayers: number;
}

export interface PlayerLookup {
  /** Name. Resolved to a uuid via the most recent observation. */
  name?: string;
  /** UUID takes precedence if provided. */
  uuid?: string;
}

function resolveUuid(db: Db, serverId: string, lookup: PlayerLookup): string | null {
  if (lookup.uuid) return lookup.uuid;
  if (!lookup.name) return null;
  const row = db
    .prepare(
      `SELECT uuid FROM events
       WHERE server_id = ? AND player = ? AND uuid IS NOT NULL
       ORDER BY ts DESC LIMIT 1`,
    )
    .get(serverId, lookup.name) as { uuid: string } | undefined;
  return row?.uuid ?? null;
}

export interface PlayerSummary {
  player: string;
  uuid: string;
  firstSeen: string | null;
  lastSeen: string | null;
  totalSessions: number;
  totalPlayMinutes: number;
  totalDiscoveries: number;
  /** The most recent value of every numeric counter this player ever recorded. */
  latestState: Record<string, number>;
}

export function getPlayerSummary(
  db: Db,
  serverId: string,
  lookup: PlayerLookup,
  fromTs: string,
  toTs: string,
): PlayerSummary | null {
  const uuid = resolveUuid(db, serverId, lookup);
  if (!uuid) return null;

  const meta = db
    .prepare(
      `SELECT
         (SELECT player FROM events
          WHERE server_id = ? AND uuid = ? AND player IS NOT NULL
          ORDER BY ts DESC LIMIT 1) AS player,
         MIN(ts) AS first_seen,
         MAX(ts) AS last_seen,
         SUM(CASE WHEN type = 'discovery' THEN 1 ELSE 0 END) AS discoveries
       FROM events
       WHERE server_id = ? AND uuid = ? AND ts >= ? AND ts < ?`,
    )
    .get(serverId, uuid, serverId, uuid, fromTs, toTs) as {
    player: string | null;
    first_seen: string | null;
    last_seen: string | null;
    discoveries: number | null;
  };

  if (!meta.player && !meta.first_seen) return null;

  const sessionAgg = db
    .prepare(
      `${SESSION_PAIRS_CTE}
       SELECT
         COUNT(*) AS total_sessions,
         SUM(
           CASE
             WHEN leave_ts IS NULL THEN 0
             ELSE CAST((julianday(leave_ts) - julianday(join_ts)) * 24 * 60 AS INTEGER)
           END
         ) AS play_minutes
       FROM sessions WHERE uuid = ? AND join_ts >= ? AND join_ts < ?`,
    )
    .get(serverId, uuid, fromTs, toTs) as {
    total_sessions: number;
    play_minutes: number | null;
  };

  // Latest value of each counter for this player within the window
  const counters = db
    .prepare(
      `SELECT c.name AS name, c.value AS value
       FROM event_counters c
       JOIN events e ON e.id = c.event_id
       WHERE e.server_id = ? AND e.uuid = ? AND e.ts >= ? AND e.ts < ?
         AND e.id IN (
           SELECT MAX(e2.id) FROM events e2
           JOIN event_counters c2 ON c2.event_id = e2.id
           WHERE e2.server_id = ? AND e2.uuid = ? AND e2.ts >= ? AND e2.ts < ?
             AND c2.name = c.name
         )`,
    )
    .all(serverId, uuid, fromTs, toTs, serverId, uuid, fromTs, toTs) as Array<{
    name: string;
    value: number;
  }>;
  const latestState: Record<string, number> = {};
  for (const c of counters) latestState[c.name] = c.value;

  return {
    player: meta.player ?? "",
    uuid,
    firstSeen: meta.first_seen,
    lastSeen: meta.last_seen,
    totalSessions: sessionAgg.total_sessions,
    totalPlayMinutes: sessionAgg.play_minutes ?? 0,
    totalDiscoveries: meta.discoveries ?? 0,
    latestState,
  };
}

export interface SessionRow {
  joinTs: string;
  leaveTs: string | null;
  durationMinutes: number | null;
}

export function getPlayerSessions(
  db: Db,
  serverId: string,
  lookup: PlayerLookup,
  fromTs: string,
  toTs: string,
): SessionRow[] {
  const uuid = resolveUuid(db, serverId, lookup);
  if (!uuid) return [];
  const rows = db
    .prepare(
      `${SESSION_PAIRS_CTE}
       SELECT join_ts, leave_ts FROM sessions
       WHERE uuid = ? AND join_ts >= ? AND join_ts < ?
       ORDER BY join_ts DESC`,
    )
    .all(serverId, uuid, fromTs, toTs) as Array<{
    join_ts: string;
    leave_ts: string | null;
  }>;
  return rows.map((r) => ({
    joinTs: r.join_ts,
    leaveTs: r.leave_ts,
    durationMinutes:
      r.leave_ts === null
        ? null
        : Math.max(
            0,
            Math.round(
              (Date.parse(r.leave_ts) - Date.parse(r.join_ts)) / 60000,
            ),
          ),
  }));
}

export interface DiscoveryRow {
  ts: string;
  entity: string | null;
  region: string | null;
  diff: number | null;
}

export function getPlayerDiscoveries(
  db: Db,
  serverId: string,
  lookup: PlayerLookup,
  fromTs: string,
  toTs: string,
  limit: number,
): DiscoveryRow[] {
  const uuid = resolveUuid(db, serverId, lookup);
  if (!uuid) return [];
  return db
    .prepare(
      `SELECT ts, entity, region, diff FROM events
       WHERE server_id = ? AND uuid = ? AND ts >= ? AND ts < ? AND type = 'discovery'
       ORDER BY ts DESC
       LIMIT ?`,
    )
    .all(serverId, uuid, fromTs, toTs, limit) as DiscoveryRow[];
}

export interface StateSeriesRow {
  ts: string;
  value: number;
}

export function getPlayerStateSeries(
  db: Db,
  serverId: string,
  lookup: PlayerLookup,
  counter: string,
  fromTs: string,
  toTs: string,
): StateSeriesRow[] {
  const uuid = resolveUuid(db, serverId, lookup);
  if (!uuid) return [];
  return db
    .prepare(
      `SELECT e.ts AS ts, c.value AS value
       FROM events e
       JOIN event_counters c ON c.event_id = e.id
       WHERE e.server_id = ? AND e.uuid = ? AND e.ts >= ? AND e.ts < ?
         AND c.name = ?
       ORDER BY e.ts ASC`,
    )
    .all(serverId, uuid, fromTs, toTs, counter) as StateSeriesRow[];
}

export function getPlayerCounters(
  db: Db,
  serverId: string,
  lookup: PlayerLookup,
): string[] {
  const uuid = resolveUuid(db, serverId, lookup);
  if (!uuid) return [];
  const rows = db
    .prepare(
      `SELECT DISTINCT c.name FROM event_counters c
       JOIN events e ON e.id = c.event_id
       WHERE e.server_id = ? AND e.uuid = ? ORDER BY c.name`,
    )
    .all(serverId, uuid) as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

export interface PlayerListEntry {
  player: string;
  uuid: string;
  lastSeen: string;
}

export function listPlayers(db: Db, serverId: string, q: string, limit: number): PlayerListEntry[] {
  const like = `%${q.toLowerCase()}%`;
  const rows = db
    .prepare(
      `SELECT
         (SELECT player FROM events e2
          WHERE e2.server_id = events.server_id AND e2.uuid = events.uuid AND e2.player IS NOT NULL
          ORDER BY e2.ts DESC LIMIT 1) AS player,
         uuid,
         MAX(ts) AS last_seen
       FROM events
       WHERE server_id = ? AND uuid IS NOT NULL
       GROUP BY uuid
       HAVING ${q.length > 0 ? "lower(player) LIKE ? OR lower(uuid) LIKE ?" : "1=1"}
       ORDER BY last_seen DESC
       LIMIT ?`,
    )
    .all(
      ...(q.length > 0 ? [serverId, like, like, limit] : [serverId, limit]),
    ) as Array<{
    player: string | null;
    uuid: string;
    last_seen: string;
  }>;
  return rows
    .filter((r) => r.player)
    .map((r) => ({ player: r.player as string, uuid: r.uuid, lastSeen: r.last_seen }));
}

export function getTopRegions(
  db: Db,
  serverId: string,
  fromTs: string,
  toTs: string,
  limit: number,
): TopRegionRow[] {
  const rows = db
    .prepare(
      `SELECT region,
              COUNT(*) AS discoveries,
              COUNT(DISTINCT uuid) AS unique_players
       FROM events
       WHERE server_id = ? AND ts >= ? AND ts < ?
         AND type = 'discovery' AND region IS NOT NULL
       GROUP BY region
       ORDER BY discoveries DESC
       LIMIT ?`,
    )
    .all(serverId, fromTs, toTs, limit) as Array<{
    region: string;
    discoveries: number;
    unique_players: number;
  }>;

  return rows.map((r) => ({
    region: r.region,
    discoveries: r.discoveries,
    uniquePlayers: r.unique_players,
  }));
}
