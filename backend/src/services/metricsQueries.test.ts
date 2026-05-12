import { describe, expect, it } from "vitest";
import { createInMemoryMetricsDb } from "./metricsDb";
import { persistImport, type ParsedExpmetricEvent } from "./logIngest";
import {
  getDiscoveriesByEntity,
  getOverviewActivity,
  getOverviewKpis,
  getOverviewPlayers,
  getPlayerCounters,
  getPlayerDiscoveries,
  getPlayerSessions,
  getPlayerStateSeries,
  getPlayerSummary,
  getRange,
  getTopRegions,
  listPlayers,
} from "./metricsQueries";

const D = "2026-05-09";
const RANGE_FROM = "0000-01-01T00:00:00";
const RANGE_TO = "9999-12-31T23:59:59";

function ev(overrides: Partial<ParsedExpmetricEvent> & { lineNo: number }): ParsedExpmetricEvent {
  return {
    ts: `${D}T12:00:00`,
    type: "join",
    entity: null,
    player: "alice",
    uuid: "uuid-alice",
    region: null,
    diff: null,
    rawLine: "raw",
    data: {},
    counters: [],
    ...overrides,
  } as ParsedExpmetricEvent;
}

describe("metrics queries", () => {
  it("computes range correctly with a single import", () => {
    const db = createInMemoryMetricsDb();
    persistImport(db, "teledosi", "2026-05-09-1.log.gz", D, null, [
      ev({ lineNo: 1, ts: `${D}T10:00:00`, type: "join" }),
      ev({ lineNo: 2, ts: `${D}T11:30:00`, type: "leave" }),
    ]);
    const r = getRange(db, "teledosi");
    expect(r.totalEvents).toBe(2);
    expect(r.totalImports).toBe(1);
    expect(r.earliestTs).toBe(`${D}T10:00:00`);
    expect(r.latestTs).toBe(`${D}T11:30:00`);
  });

  it("pairs join/leave into sessions and computes play minutes", () => {
    const db = createInMemoryMetricsDb();
    persistImport(db, "teledosi", "2026-05-09-1.log.gz", D, null, [
      ev({ lineNo: 1, ts: `${D}T10:00:00`, type: "join", uuid: "u-a", player: "alice" }),
      ev({ lineNo: 2, ts: `${D}T10:30:00`, type: "leave", uuid: "u-a", player: "alice" }),
      ev({ lineNo: 3, ts: `${D}T11:00:00`, type: "join", uuid: "u-b", player: "bob" }),
      ev({ lineNo: 4, ts: `${D}T11:45:00`, type: "leave", uuid: "u-b", player: "bob" }),
    ]);
    const k = getOverviewKpis(db, "teledosi", RANGE_FROM, RANGE_TO);
    expect(k.totalSessions).toBe(2);
    expect(k.totalJoins).toBe(2);
    expect(k.totalLeaves).toBe(2);
    expect(k.uniquePlayers).toBe(2);
    expect(k.totalPlayMinutes).toBe(75);
    expect(k.daysActive).toBe(1);
  });

  it("treats a join with no following leave as an open session", () => {
    const db = createInMemoryMetricsDb();
    persistImport(db, "teledosi", "2026-05-09-1.log.gz", D, null, [
      ev({ lineNo: 1, ts: `${D}T10:00:00`, type: "join", uuid: "u-a", player: "alice" }),
    ]);
    const k = getOverviewKpis(db, "teledosi", RANGE_FROM, RANGE_TO);
    expect(k.totalSessions).toBe(1);
    expect(k.totalPlayMinutes).toBe(0);
  });

  it("returns players sorted by last seen with discovery breakdown", () => {
    const db = createInMemoryMetricsDb();
    persistImport(db, "teledosi", "2026-05-09-1.log.gz", D, null, [
      ev({ lineNo: 1, ts: `${D}T10:00:00`, type: "join", uuid: "u-a", player: "alice" }),
      ev({
        lineNo: 2,
        ts: `${D}T10:05:00`,
        type: "discovery",
        entity: "region",
        uuid: "u-a",
        player: "alice",
        region: "Holarea",
      }),
      ev({
        lineNo: 3,
        ts: `${D}T10:06:00`,
        type: "discovery",
        entity: "structure",
        uuid: "u-a",
        player: "alice",
        region: "Marrow Jacks Hoard",
      }),
      ev({ lineNo: 4, ts: `${D}T11:00:00`, type: "join", uuid: "u-b", player: "bob" }),
    ]);
    const players = getOverviewPlayers(db, "teledosi", RANGE_FROM, RANGE_TO);
    expect(players).toHaveLength(2);
    expect(players[0].player).toBe("bob");
    const alice = players.find((p) => p.player === "alice")!;
    expect(alice.discoveries).toBe(2);
    expect(alice.discoveriesByEntity.region).toBe(1);
    expect(alice.discoveriesByEntity.structure).toBe(1);
    expect(alice.discoveriesByEntity.village).toBe(0);
  });

  it("buckets activity by day", () => {
    const db = createInMemoryMetricsDb();
    persistImport(db, "teledosi", "2026-05-09-1.log.gz", D, null, [
      ev({ lineNo: 1, ts: `${D}T10:00:00`, type: "join", uuid: "u-a" }),
      ev({
        lineNo: 2,
        ts: `${D}T10:01:00`,
        type: "discovery",
        entity: "region",
        uuid: "u-a",
        region: "X",
      }),
    ]);
    persistImport(db, "teledosi", "2026-05-10-1.log.gz", "2026-05-10", null, [
      ev({ lineNo: 1, ts: `2026-05-10T08:00:00`, type: "join", uuid: "u-b" }),
    ]);
    const rows = getOverviewActivity(db, "teledosi", RANGE_FROM, RANGE_TO, "day");
    expect(rows.map((r) => r.bucket)).toEqual([D, "2026-05-10"]);
    expect(rows[0].joins).toBe(1);
    expect(rows[0].discoveries).toBe(1);
    expect(rows[1].joins).toBe(1);
  });

  it("respects the date range window", () => {
    const db = createInMemoryMetricsDb();
    persistImport(db, "teledosi", "2026-05-08-1.log.gz", "2026-05-08", null, [
      ev({ lineNo: 1, ts: "2026-05-08T10:00:00", type: "join", uuid: "u-a" }),
    ]);
    persistImport(db, "teledosi", "2026-05-09-1.log.gz", D, null, [
      ev({ lineNo: 1, ts: `${D}T10:00:00`, type: "join", uuid: "u-b" }),
    ]);
    const k = getOverviewKpis(db, "teledosi", `${D}T00:00:00`, "2026-05-10T00:00:00");
    expect(k.totalJoins).toBe(1);
    expect(k.uniquePlayers).toBe(1);
  });

  it("resolves a player by name and returns sessions/discoveries/state", () => {
    const db = createInMemoryMetricsDb();
    persistImport(db, "teledosi", "2026-05-09-1.log.gz", D, null, [
      ev({ lineNo: 1, ts: `${D}T10:00:00`, type: "join", uuid: "u-a", player: "alice" }),
      ev({
        lineNo: 2,
        ts: `${D}T10:05:00`,
        type: "discovery",
        entity: "region",
        uuid: "u-a",
        player: "alice",
        region: "Holarea",
        diff: 1,
      }),
      ev({
        lineNo: 3,
        ts: `${D}T10:10:00`,
        type: "state",
        entity: "region",
        uuid: "u-a",
        player: "alice",
        counters: [
          { name: "total", value: 1 },
          { name: "regions", value: 1 },
        ],
      }),
      ev({
        lineNo: 4,
        ts: `${D}T10:30:00`,
        type: "discovery",
        entity: "structure",
        uuid: "u-a",
        player: "alice",
        region: "Marrow Jacks Hoard",
      }),
      ev({
        lineNo: 5,
        ts: `${D}T10:35:00`,
        type: "state",
        entity: "structure",
        uuid: "u-a",
        player: "alice",
        counters: [
          { name: "structures_found", value: 1 },
          { name: "buried_treasures_found", value: 1 },
        ],
      }),
      ev({ lineNo: 6, ts: `${D}T11:00:00`, type: "leave", uuid: "u-a", player: "alice" }),
    ]);

    const summary = getPlayerSummary(
      db,
      "teledosi",
      { name: "alice" },
      RANGE_FROM,
      RANGE_TO,
    );
    expect(summary).not.toBeNull();
    expect(summary?.player).toBe("alice");
    expect(summary?.uuid).toBe("u-a");
    expect(summary?.totalSessions).toBe(1);
    expect(summary?.totalPlayMinutes).toBe(60);
    expect(summary?.totalDiscoveries).toBe(2);
    expect(summary?.latestState).toMatchObject({
      regions: 1,
      total: 1,
      structures_found: 1,
      buried_treasures_found: 1,
    });

    const sessions = getPlayerSessions(
      db,
      "teledosi",
      { name: "alice" },
      RANGE_FROM,
      RANGE_TO,
    );
    expect(sessions).toEqual([
      { joinTs: `${D}T10:00:00`, leaveTs: `${D}T11:00:00`, durationMinutes: 60 },
    ]);

    const discoveries = getPlayerDiscoveries(
      db,
      "teledosi",
      { name: "alice" },
      RANGE_FROM,
      RANGE_TO,
      100,
    );
    expect(discoveries).toHaveLength(2);
    expect(discoveries[0].region).toBe("Marrow Jacks Hoard");

    const series = getPlayerStateSeries(
      db,
      "teledosi",
      { name: "alice" },
      "regions",
      RANGE_FROM,
      RANGE_TO,
    );
    expect(series).toEqual([{ ts: `${D}T10:10:00`, value: 1 }]);

    const counters = getPlayerCounters(db, "teledosi", { name: "alice" });
    expect(counters).toEqual([
      "buried_treasures_found",
      "regions",
      "structures_found",
      "total",
    ]);

    const list = listPlayers(db, "teledosi", "ali", 10);
    expect(list).toEqual([
      { player: "alice", uuid: "u-a", lastSeen: `${D}T11:00:00` },
    ]);
  });

  it("returns null for unknown player", () => {
    const db = createInMemoryMetricsDb();
    persistImport(db, "teledosi", "2026-05-09-1.log.gz", D, null, [
      ev({ lineNo: 1, ts: `${D}T10:00:00`, type: "join", uuid: "u-a", player: "alice" }),
    ]);
    expect(
      getPlayerSummary(db, "teledosi", { name: "nobody" }, RANGE_FROM, RANGE_TO),
    ).toBeNull();
  });

  it("ranks regions and entity discoveries", () => {
    const db = createInMemoryMetricsDb();
    persistImport(db, "teledosi", "2026-05-09-1.log.gz", D, null, [
      ev({
        lineNo: 1,
        ts: `${D}T10:00:00`,
        type: "discovery",
        entity: "region",
        uuid: "u-a",
        region: "Holarea",
      }),
      ev({
        lineNo: 2,
        ts: `${D}T10:01:00`,
        type: "discovery",
        entity: "region",
        uuid: "u-b",
        region: "Holarea",
      }),
      ev({
        lineNo: 3,
        ts: `${D}T10:02:00`,
        type: "discovery",
        entity: "structure",
        uuid: "u-a",
        region: "Marrow Jacks Hoard",
      }),
    ]);
    const top = getTopRegions(db, "teledosi", RANGE_FROM, RANGE_TO, 5);
    expect(top[0].region).toBe("Holarea");
    expect(top[0].discoveries).toBe(2);
    expect(top[0].uniquePlayers).toBe(2);

    const byEntity = getDiscoveriesByEntity(db, "teledosi", RANGE_FROM, RANGE_TO);
    const map = new Map(byEntity.map((r) => [r.entity, r.count]));
    expect(map.get("region")).toBe(2);
    expect(map.get("structure")).toBe(1);
  });
});
