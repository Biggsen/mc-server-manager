import { describe, expect, it } from "vitest";
import {
  GZ_FILE_NAME_RE,
  dateFromGzFileName,
  parseExpmetricLine,
  persistImport,
  type ParsedExpmetricEvent,
} from "./logIngest";
import { createInMemoryMetricsDb } from "./metricsDb";

const D = "2026-05-09";

describe("parseExpmetricLine", () => {
  it("returns null for non-EXPMETRIC lines", () => {
    expect(parseExpmetricLine("[17:10:27] [Server thread/INFO]: Loaded recipes", 1, D)).toBeNull();
  });

  it("returns null for malformed lines", () => {
    expect(parseExpmetricLine("nope", 1, D)).toBeNull();
    expect(parseExpmetricLine("", 1, D)).toBeNull();
  });

  it("parses a join event (no entity, no region)", () => {
    const line =
      "[20:54:09] [Server thread/INFO]: [EXPMETRIC] server=Teledosi type=join player=maruchimedia uuid=f4398af1-6d18-4f80-ba10-4bceddb1427c";
    const ev = parseExpmetricLine(line, 7, D);
    expect(ev).not.toBeNull();
    const e = ev as ParsedExpmetricEvent;
    expect(e.ts).toBe(`${D}T20:54:09`);
    expect(e.type).toBe("join");
    expect(e.entity).toBeNull();
    expect(e.region).toBeNull();
    expect(e.player).toBe("maruchimedia");
    expect(e.uuid).toBe("f4398af1-6d18-4f80-ba10-4bceddb1427c");
    expect(e.diff).toBeNull();
    expect(e.counters).toEqual([]);
    expect(e.lineNo).toBe(7);
    expect(e.data.server).toBe("Teledosi");
  });

  it("parses a discovery with a single-word region", () => {
    const line =
      "[20:54:20] [Server thread/INFO]: [EXPMETRIC] server=Teledosi type=discovery entity=region player=maruchimedia uuid=f4398af1-6d18-4f80-ba10-4bceddb1427c region=Holarea diff=1";
    const ev = parseExpmetricLine(line, 1, D);
    expect(ev?.region).toBe("Holarea");
    expect(ev?.diff).toBe(1);
    expect(ev?.entity).toBe("region");
  });

  it("parses a discovery with a multi-word region (the tricky case)", () => {
    const line =
      "[20:55:54] [Server thread/INFO]: [EXPMETRIC] server=Teledosi type=discovery entity=structure player=maruchimedia uuid=f4398af1-6d18-4f80-ba10-4bceddb1427c region=Marrow Jacks Hoard diff=0";
    const ev = parseExpmetricLine(line, 1, D);
    expect(ev?.region).toBe("Marrow Jacks Hoard");
    expect(ev?.diff).toBe(0);
    expect(ev?.entity).toBe("structure");
  });

  it("parses a discovery whose region is the last token", () => {
    const line =
      "[21:01:29] [Server thread/INFO]: [EXPMETRIC] server=Teledosi type=discovery entity=region player=x uuid=u region=Ebon Of The Festering";
    const ev = parseExpmetricLine(line, 1, D);
    expect(ev?.region).toBe("Ebon Of The Festering");
    expect(ev?.diff).toBeNull();
  });

  it("parses a state event with multiple dynamic counters", () => {
    const line =
      "[21:05:23] [Server thread/INFO]: [EXPMETRIC] server=Teledosi type=state entity=structure player=maruchimedia uuid=f4398af1-6d18-4f80-ba10-4bceddb1427c buried_treasures_found=2 structures_found=2";
    const ev = parseExpmetricLine(line, 1, D);
    const counters = (ev as ParsedExpmetricEvent).counters
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(counters).toEqual([
      { name: "buried_treasures_found", value: 2 },
      { name: "structures_found", value: 2 },
    ]);
  });

  it("parses a state region event with total + entity counter", () => {
    const line =
      "[20:55:30] [Server thread/INFO]: [EXPMETRIC] server=Teledosi type=state entity=region player=x uuid=u total=1 regions=1";
    const ev = parseExpmetricLine(line, 1, D);
    const names = (ev as ParsedExpmetricEvent).counters.map((c) => c.name).sort();
    expect(names).toEqual(["regions", "total"]);
  });

  it("does not throw on a line without a [HH:MM:SS] prefix", () => {
    const line = "[EXPMETRIC] server=Teledosi type=join player=x uuid=u";
    expect(parseExpmetricLine(line, 1, D)).toBeNull();
  });

  it("ignores trailing whitespace", () => {
    const line =
      "[21:06:12] [Server thread/INFO]: [EXPMETRIC] server=Teledosi type=leave player=maruchimedia uuid=f4398af1-6d18-4f80-ba10-4bceddb1427c   ";
    const ev = parseExpmetricLine(line, 1, D);
    expect(ev?.type).toBe("leave");
    expect(ev?.player).toBe("maruchimedia");
  });
});

describe("dateFromGzFileName", () => {
  it("extracts the date from valid filenames", () => {
    expect(dateFromGzFileName("2026-05-09-4.log.gz")).toBe("2026-05-09");
    expect(dateFromGzFileName("2026-12-31-12.log.gz")).toBe("2026-12-31");
  });

  it("rejects filenames that don't match", () => {
    expect(dateFromGzFileName("latest.log")).toBeNull();
    expect(dateFromGzFileName("2026-05-09-4.log")).toBeNull();
    expect(dateFromGzFileName("server.log.gz")).toBeNull();
  });
});

describe("GZ_FILE_NAME_RE", () => {
  it("only accepts finalised .log.gz files", () => {
    expect(GZ_FILE_NAME_RE.test("2026-05-09-4.log.gz")).toBe(true);
    expect(GZ_FILE_NAME_RE.test("latest.log")).toBe(false);
    expect(GZ_FILE_NAME_RE.test("latest.log.gz")).toBe(false);
    expect(GZ_FILE_NAME_RE.test("../../../etc/passwd")).toBe(false);
  });
});

describe("persistImport", () => {
  function makeEvent(overrides: Partial<ParsedExpmetricEvent> = {}): ParsedExpmetricEvent {
    return {
      ts: `${D}T12:00:00`,
      type: "join",
      entity: null,
      player: "alice",
      uuid: "u",
      region: null,
      diff: null,
      lineNo: 1,
      rawLine: "[12:00:00] [EXPMETRIC] server=S type=join player=alice uuid=u",
      data: { server: "S", type: "join", player: "alice", uuid: "u" },
      counters: [],
      ...overrides,
    };
  }

  it("writes events and counters atomically", () => {
    const db = createInMemoryMetricsDb();
    const events = [
      makeEvent(),
      makeEvent({
        type: "state",
        entity: "region",
        counters: [
          { name: "total", value: 3 },
          { name: "regions", value: 2 },
        ],
        lineNo: 2,
      }),
    ];
    const result = persistImport(db, "teledosi", "2026-05-09-4.log.gz", D, 12345, events);
    expect(result.eventCount).toBe(2);

    const eventCount = db.prepare("SELECT COUNT(*) AS c FROM events").get() as { c: number };
    const counterCount = db
      .prepare("SELECT COUNT(*) AS c FROM event_counters")
      .get() as { c: number };
    expect(eventCount.c).toBe(2);
    expect(counterCount.c).toBe(2);
  });

  it("re-import replaces previous data for the same file", () => {
    const db = createInMemoryMetricsDb();
    persistImport(db, "teledosi", "2026-05-09-4.log.gz", D, null, [makeEvent({ player: "v1" })]);
    persistImport(db, "teledosi", "2026-05-09-4.log.gz", D, null, [makeEvent({ player: "v2" })]);
    const players = db
      .prepare("SELECT player FROM events ORDER BY id")
      .all() as Array<{ player: string }>;
    expect(players).toEqual([{ player: "v2" }]);
  });

  it("re-import is scoped per (server, file)", () => {
    const db = createInMemoryMetricsDb();
    persistImport(db, "teledosi", "2026-05-09-4.log.gz", D, null, [makeEvent({ player: "T" })]);
    persistImport(db, "charidh", "2026-05-09-4.log.gz", D, null, [makeEvent({ player: "C" })]);
    const rows = db
      .prepare("SELECT server_id, player FROM events ORDER BY server_id, id")
      .all() as Array<{ server_id: string; player: string }>;
    expect(rows).toEqual([
      { server_id: "charidh", player: "C" },
      { server_id: "teledosi", player: "T" },
    ]);
  });
});
