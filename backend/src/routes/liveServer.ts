import type { Request, Response } from "express";
import { Router } from "express";
import type { LiveServerConfig } from "../config";
import {
  isLiveServerConfigured,
  isLiveServerFilesConfigured,
  isLiveServerRconConfigured,
  isLiveServerSshConfigured,
  liveServerFilesNotConfiguredMessage,
  liveServerNotConfiguredMessage,
  liveServerRconNotConfiguredMessage,
} from "../config";
import {
  connectLiveServerClient,
  getLiveServerRecentLogs,
  getLiveServerStatus,
  streamLiveServerJournalFollow,
  liveServerSystemctl,
} from "../services/liveServerRemote";
import {
  LiveServerFileTooLargeError,
  liveServerFilesList,
  liveServerFilesRead,
  liveServerFilesWrite,
} from "../services/liveServerFiles";
import { executeRconCommand, LiveServerRconError } from "../services/rconClient";
import {
  GZ_FILE_NAME_RE,
  ingestRemoteGzLog,
  LogIngestError,
} from "../services/logIngest";
import { ingestJobs } from "../services/ingestJobRegistry";
import { getMetricsDb } from "../services/metricsDb";
import { readLatestLogPreview } from "../services/liveLogPreview";
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
  type ActivityBucket,
  type PlayerLookup,
} from "../services/metricsQueries";

export function createLiveServerRouter(cfg: LiveServerConfig): Router {
  const router = Router();

  function notConfigured(res: Response): boolean {
    if (isLiveServerConfigured(cfg)) {
      return false;
    }
    res.status(503).json({ error: liveServerNotConfiguredMessage(cfg) });
    return true;
  }

  function formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  router.get("/status", async (_req: Request, res: Response) => {
    if (notConfigured(res)) return;
    try {
      const { state, raw } = await getLiveServerStatus(cfg);
      res.json({ state, raw });
    } catch (error) {
      console.error(`Live server "${cfg.id}" status error`, error);
      res.status(502).json({ error: formatError(error) });
    }
  });

  router.post("/start", async (_req: Request, res: Response) => {
    if (notConfigured(res)) return;
    try {
      const r = await liveServerSystemctl(cfg, "start");
      const out = (r.stdout + r.stderr).trim();
      if (r.code !== 0) {
        res.status(502).json({ error: out || `systemctl exited with code ${r.code}` });
        return;
      }
      res.json({ ok: true, output: out || undefined });
    } catch (error) {
      console.error(`Live server "${cfg.id}" start error`, error);
      res.status(502).json({ error: formatError(error) });
    }
  });

  router.post("/stop", async (_req: Request, res: Response) => {
    if (notConfigured(res)) return;
    try {
      const r = await liveServerSystemctl(cfg, "stop");
      const out = (r.stdout + r.stderr).trim();
      if (r.code !== 0) {
        res.status(502).json({ error: out || `systemctl exited with code ${r.code}` });
        return;
      }
      res.json({ ok: true, output: out || undefined });
    } catch (error) {
      console.error(`Live server "${cfg.id}" stop error`, error);
      res.status(502).json({ error: formatError(error) });
    }
  });

  router.post("/restart", async (_req: Request, res: Response) => {
    if (notConfigured(res)) return;
    try {
      const r = await liveServerSystemctl(cfg, "restart");
      const out = (r.stdout + r.stderr).trim();
      if (r.code !== 0) {
        res.status(502).json({ error: out || `systemctl exited with code ${r.code}` });
        return;
      }
      res.json({ ok: true, output: out || undefined });
    } catch (error) {
      console.error(`Live server "${cfg.id}" restart error`, error);
      res.status(502).json({ error: formatError(error) });
    }
  });

  router.post("/command", async (req: Request, res: Response) => {
    const command = typeof req.body?.command === "string" ? req.body.command.trim() : "";
    if (!command) {
      res.status(400).json({ error: "Command is required" });
      return;
    }
    if (!isLiveServerRconConfigured(cfg)) {
      res.status(503).json({ error: liveServerRconNotConfiguredMessage(cfg) });
      return;
    }
    try {
      const { response } = await executeRconCommand(cfg, command);
      res.json({ ok: true, response });
    } catch (error) {
      if (error instanceof LiveServerRconError) {
        if (error.code === "NOT_CONFIGURED") {
          res.status(503).json({ error: liveServerRconNotConfiguredMessage(cfg) });
          return;
        }
        if (error.code === "AUTH_FAILED") {
          res.status(401).json({ error: error.message });
          return;
        }
        if (error.code === "TIMEOUT") {
          res.status(504).json({ error: error.message });
          return;
        }
        if (error.code === "NETWORK") {
          res.status(502).json({ error: error.message });
          return;
        }
        if (error.code === "BINARY_MISSING") {
          res.status(500).json({ error: error.message });
          return;
        }
        if (error.code === "SSH") {
          res.status(502).json({ error: error.message });
          return;
        }
        res.status(500).json({ error: error.message });
        return;
      }
      console.error(`Live server "${cfg.id}" RCON command error`, error);
      res.status(500).json({ error: formatError(error) });
    }
  });

  router.get("/logs", async (req: Request, res: Response) => {
    if (notConfigured(res)) return;
    const linesParam = typeof req.query.lines === "string" ? Number(req.query.lines) : undefined;
    try {
      const text = await getLiveServerRecentLogs(cfg, linesParam);
      res.json({ text });
    } catch (error) {
      console.error(`Live server "${cfg.id}" logs error`, error);
      res.status(502).json({ error: formatError(error) });
    }
  });

  router.get("/logs/stream", async (req: Request, res: Response) => {
    if (notConfigured(res)) return;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const sendEvent = (event: string, payload: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    let conn: Awaited<ReturnType<typeof connectLiveServerClient>>;
    try {
      conn = await connectLiveServerClient(cfg);
    } catch (error) {
      sendEvent("streamerror", { message: formatError(error) });
      res.end();
      return;
    }

    sendEvent("init", { ok: true });

    const keepAlive = setInterval(() => {
      res.write(": keep-alive\n\n");
    }, 25000);

    const cleanup = () => {
      clearInterval(keepAlive);
      try {
        conn.end();
      } catch {
        /* ignore */
      }
    };

    req.on("close", () => {
      cleanup();
      res.end();
    });

    streamLiveServerJournalFollow(
      cfg,
      conn,
      (line) => sendEvent("log", { line }),
      (err) => {
        sendEvent("streamerror", { message: err.message });
        cleanup();
        res.end();
      },
    );
  });

  router.get("/files/config", (_req: Request, res: Response) => {
    res.json({
      filesConfigured: isLiveServerFilesConfigured(cfg),
      remoteRoot: isLiveServerFilesConfigured(cfg) ? cfg.files.remoteRoot : undefined,
      maxBytes: cfg.files.maxBytes,
      hint: isLiveServerFilesConfigured(cfg)
        ? undefined
        : isLiveServerSshConfigured(cfg)
          ? liveServerFilesNotConfiguredMessage(cfg)
          : liveServerNotConfiguredMessage(cfg),
    });
  });

  function filesNotReady(res: Response): boolean {
    if (isLiveServerFilesConfigured(cfg)) {
      return false;
    }
    res.status(503).json({
      error: isLiveServerSshConfigured(cfg)
        ? liveServerFilesNotConfiguredMessage(cfg)
        : liveServerNotConfiguredMessage(cfg),
    });
    return true;
  }

  router.get("/files/list", async (req: Request, res: Response) => {
    if (filesNotReady(res)) return;
    const pathParam = typeof req.query.path === "string" ? req.query.path : "";
    try {
      const entries = await liveServerFilesList(cfg, pathParam);
      res.json({ entries });
    } catch (error) {
      console.error(`Live server "${cfg.id}" files list error`, error);
      res.status(502).json({ error: formatError(error) });
    }
  });

  router.get("/files/read", async (req: Request, res: Response) => {
    if (filesNotReady(res)) return;
    const pathParam = typeof req.query.path === "string" ? req.query.path : "";
    if (!pathParam.trim()) {
      res.status(400).json({ error: "path query parameter is required" });
      return;
    }
    try {
      const { content, isBinary } = await liveServerFilesRead(cfg, pathParam);
      res.json({ path: pathParam, content, isBinary });
    } catch (error) {
      console.error(`Live server "${cfg.id}" files read error`, error);
      if (error instanceof LiveServerFileTooLargeError) {
        res.status(413).json({ error: error.message });
        return;
      }
      res.status(502).json({ error: formatError(error) });
    }
  });

  router.get("/logs/files", async (_req: Request, res: Response) => {
    if (filesNotReady(res)) return;
    try {
      const entries = await liveServerFilesList(cfg, "logs");
      const gzFiles = entries.filter(
        (e) => e.type === "file" && GZ_FILE_NAME_RE.test(e.name),
      );
      const latestEntry = entries.find(
        (e) => e.type === "file" && e.name === "latest.log",
      );

      const db = getMetricsDb();
      const importsRows = db
        .prepare(
          `SELECT file_name, event_count, imported_at, size_bytes
           FROM log_imports WHERE server_id = ?`,
        )
        .all(cfg.id) as Array<{
        file_name: string;
        event_count: number;
        imported_at: string;
        size_bytes: number | null;
      }>;
      const importedByName = new Map(importsRows.map((r) => [r.file_name, r]));

      const files = gzFiles
        .slice()
        .sort((a, b) => b.name.localeCompare(a.name))
        .map((entry) => {
          const imp = importedByName.get(entry.name);
          return {
            name: entry.name,
            size: entry.size ?? null,
            mtime: entry.mtime ?? null,
            imported: Boolean(imp),
            eventCount: imp?.event_count ?? null,
            importedAt: imp?.imported_at ?? null,
          };
        });

      const latest = latestEntry
        ? {
            name: latestEntry.name,
            size: latestEntry.size ?? null,
            mtime: latestEntry.mtime ?? null,
          }
        : null;

      res.json({ files, latest });
    } catch (error) {
      console.error(`Live server "${cfg.id}" logs/files error`, error);
      res.status(502).json({ error: formatError(error) });
    }
  });

  router.post("/logs/ingest", async (req: Request, res: Response) => {
    if (filesNotReady(res)) return;
    const file = typeof req.body?.file === "string" ? req.body.file.trim() : "";
    if (!file) {
      res.status(400).json({ error: "file is required" });
      return;
    }
    if (!GZ_FILE_NAME_RE.test(file)) {
      res.status(400).json({
        error:
          "Only finalised YYYY-MM-DD-N.log.gz files can be imported. latest.log is preview-only.",
      });
      return;
    }
    try {
      const result = await ingestRemoteGzLog(cfg, file);
      res.json(result);
    } catch (error) {
      console.error(`Live server "${cfg.id}" logs/ingest error`, error);
      if (error instanceof LogIngestError) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(502).json({ error: formatError(error) });
    }
  });

  router.get("/metrics/live", async (_req: Request, res: Response) => {
    if (filesNotReady(res)) return;
    try {
      const preview = await readLatestLogPreview(cfg);
      res.json(preview);
    } catch (error) {
      console.error(`Live server "${cfg.id}" metrics/live error`, error);
      res.status(502).json({ error: formatError(error) });
    }
  });

  router.get("/metrics/range", (_req: Request, res: Response) => {
    try {
      res.json(getRange(getMetricsDb(), cfg.id));
    } catch (error) {
      console.error(`Live server "${cfg.id}" metrics/range error`, error);
      res.status(500).json({ error: formatError(error) });
    }
  });

  function parseRange(req: Request): { from: string; to: string } {
    const fromRaw = typeof req.query.from === "string" ? req.query.from : "";
    const toRaw = typeof req.query.to === "string" ? req.query.to : "";
    const from = fromRaw && /^\d{4}-\d{2}-\d{2}/.test(fromRaw) ? fromRaw : "0000-01-01T00:00:00";
    const to = toRaw && /^\d{4}-\d{2}-\d{2}/.test(toRaw) ? toRaw : "9999-12-31T23:59:59";
    return { from, to };
  }

  router.get("/metrics/overview/kpis", (req: Request, res: Response) => {
    try {
      const { from, to } = parseRange(req);
      res.json(getOverviewKpis(getMetricsDb(), cfg.id, from, to));
    } catch (error) {
      console.error(`Live server "${cfg.id}" metrics/overview/kpis error`, error);
      res.status(500).json({ error: formatError(error) });
    }
  });

  router.get("/metrics/overview/activity", (req: Request, res: Response) => {
    try {
      const { from, to } = parseRange(req);
      const bucketRaw = typeof req.query.bucket === "string" ? req.query.bucket : "day";
      const bucket: ActivityBucket = bucketRaw === "hour" ? "hour" : "day";
      res.json({ bucket, rows: getOverviewActivity(getMetricsDb(), cfg.id, from, to, bucket) });
    } catch (error) {
      console.error(`Live server "${cfg.id}" metrics/overview/activity error`, error);
      res.status(500).json({ error: formatError(error) });
    }
  });

  router.get("/metrics/overview/players", (req: Request, res: Response) => {
    try {
      const { from, to } = parseRange(req);
      res.json({ rows: getOverviewPlayers(getMetricsDb(), cfg.id, from, to) });
    } catch (error) {
      console.error(`Live server "${cfg.id}" metrics/overview/players error`, error);
      res.status(500).json({ error: formatError(error) });
    }
  });

  router.get("/metrics/overview/discoveries-by-entity", (req: Request, res: Response) => {
    try {
      const { from, to } = parseRange(req);
      res.json({ rows: getDiscoveriesByEntity(getMetricsDb(), cfg.id, from, to) });
    } catch (error) {
      console.error(
        `Live server "${cfg.id}" metrics/overview/discoveries-by-entity error`,
        error,
      );
      res.status(500).json({ error: formatError(error) });
    }
  });

  router.get("/metrics/overview/top-regions", (req: Request, res: Response) => {
    try {
      const { from, to } = parseRange(req);
      const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : 10;
      const limit =
        Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(100, Math.floor(limitRaw)) : 10;
      res.json({ rows: getTopRegions(getMetricsDb(), cfg.id, from, to, limit) });
    } catch (error) {
      console.error(`Live server "${cfg.id}" metrics/overview/top-regions error`, error);
      res.status(500).json({ error: formatError(error) });
    }
  });

  function parseLookup(req: Request): PlayerLookup | null {
    const player = typeof req.query.player === "string" ? req.query.player.trim() : "";
    const uuid = typeof req.query.uuid === "string" ? req.query.uuid.trim() : "";
    if (!player && !uuid) return null;
    return { name: player || undefined, uuid: uuid || undefined };
  }

  router.get("/metrics/players/list", (req: Request, res: Response) => {
    try {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : 20;
      const limit =
        Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(100, Math.floor(limitRaw)) : 20;
      res.json({ rows: listPlayers(getMetricsDb(), cfg.id, q, limit) });
    } catch (error) {
      console.error(`Live server "${cfg.id}" metrics/players/list error`, error);
      res.status(500).json({ error: formatError(error) });
    }
  });

  router.get("/metrics/player/summary", (req: Request, res: Response) => {
    const lookup = parseLookup(req);
    if (!lookup) {
      res.status(400).json({ error: "player or uuid query parameter is required" });
      return;
    }
    try {
      const { from, to } = parseRange(req);
      const summary = getPlayerSummary(getMetricsDb(), cfg.id, lookup, from, to);
      if (!summary) {
        res.status(404).json({ error: "Player not found in this server's data" });
        return;
      }
      res.json(summary);
    } catch (error) {
      console.error(`Live server "${cfg.id}" metrics/player/summary error`, error);
      res.status(500).json({ error: formatError(error) });
    }
  });

  router.get("/metrics/player/sessions", (req: Request, res: Response) => {
    const lookup = parseLookup(req);
    if (!lookup) {
      res.status(400).json({ error: "player or uuid query parameter is required" });
      return;
    }
    try {
      const { from, to } = parseRange(req);
      res.json({ rows: getPlayerSessions(getMetricsDb(), cfg.id, lookup, from, to) });
    } catch (error) {
      console.error(`Live server "${cfg.id}" metrics/player/sessions error`, error);
      res.status(500).json({ error: formatError(error) });
    }
  });

  router.get("/metrics/player/discoveries", (req: Request, res: Response) => {
    const lookup = parseLookup(req);
    if (!lookup) {
      res.status(400).json({ error: "player or uuid query parameter is required" });
      return;
    }
    try {
      const { from, to } = parseRange(req);
      const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : 200;
      const limit =
        Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(2000, Math.floor(limitRaw)) : 200;
      res.json({
        rows: getPlayerDiscoveries(getMetricsDb(), cfg.id, lookup, from, to, limit),
      });
    } catch (error) {
      console.error(`Live server "${cfg.id}" metrics/player/discoveries error`, error);
      res.status(500).json({ error: formatError(error) });
    }
  });

  router.get("/metrics/player/state-series", (req: Request, res: Response) => {
    const lookup = parseLookup(req);
    if (!lookup) {
      res.status(400).json({ error: "player or uuid query parameter is required" });
      return;
    }
    const counter = typeof req.query.counter === "string" ? req.query.counter.trim() : "";
    if (!counter) {
      res.status(400).json({ error: "counter query parameter is required" });
      return;
    }
    try {
      const { from, to } = parseRange(req);
      res.json({
        counter,
        rows: getPlayerStateSeries(getMetricsDb(), cfg.id, lookup, counter, from, to),
      });
    } catch (error) {
      console.error(`Live server "${cfg.id}" metrics/player/state-series error`, error);
      res.status(500).json({ error: formatError(error) });
    }
  });

  router.get("/metrics/player/counters", (req: Request, res: Response) => {
    const lookup = parseLookup(req);
    if (!lookup) {
      res.status(400).json({ error: "player or uuid query parameter is required" });
      return;
    }
    try {
      res.json({ counters: getPlayerCounters(getMetricsDb(), cfg.id, lookup) });
    } catch (error) {
      console.error(`Live server "${cfg.id}" metrics/player/counters error`, error);
      res.status(500).json({ error: formatError(error) });
    }
  });

  router.post("/logs/ingest-all", async (_req: Request, res: Response) => {
    if (filesNotReady(res)) return;
    try {
      const entries = await liveServerFilesList(cfg, "logs");
      const allFiles = entries
        .filter((e) => e.type === "file" && GZ_FILE_NAME_RE.test(e.name))
        .map((e) => e.name);

      const db = getMetricsDb();
      const importedRows = db
        .prepare(`SELECT file_name FROM log_imports WHERE server_id = ?`)
        .all(cfg.id) as Array<{ file_name: string }>;
      const importedSet = new Set(importedRows.map((r) => r.file_name));

      const pending = allFiles.filter((f) => !importedSet.has(f)).sort();
      if (pending.length === 0) {
        res.json({ jobId: null, files: [] });
        return;
      }

      const job = ingestJobs.start(cfg, pending);
      res.json({ jobId: job.id, files: pending });
    } catch (error) {
      console.error(`Live server "${cfg.id}" logs/ingest-all error`, error);
      res.status(502).json({ error: formatError(error) });
    }
  });

  router.get("/logs/jobs/:jobId", (req: Request, res: Response) => {
    const job = ingestJobs.get(req.params.jobId);
    if (!job || job.serverId !== cfg.id) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json(job);
  });

  router.get("/logs/jobs/:jobId/stream", (req: Request, res: Response) => {
    const initial = ingestJobs.get(req.params.jobId);
    if (!initial || initial.serverId !== cfg.id) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (job: typeof initial) => {
      res.write(`event: progress\n`);
      res.write(`data: ${JSON.stringify(job)}\n\n`);
    };

    const unsubscribe = ingestJobs.subscribe(req.params.jobId, (job) => {
      send(job);
      if (job.status === "completed" || job.status === "failed") {
        res.end();
      }
    });

    if (!unsubscribe) {
      res.end();
      return;
    }

    const keepAlive = setInterval(() => {
      res.write(": keep-alive\n\n");
    }, 25000);

    req.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
      res.end();
    });
  });

  router.delete("/logs/imports/:fileName", (req: Request, res: Response) => {
    const fileName = req.params.fileName;
    if (!fileName || !GZ_FILE_NAME_RE.test(fileName)) {
      res.status(400).json({ error: "Invalid file name" });
      return;
    }
    try {
      const db = getMetricsDb();
      const result = db
        .prepare(`DELETE FROM log_imports WHERE server_id = ? AND file_name = ?`)
        .run(cfg.id, fileName);
      res.json({ ok: true, deleted: result.changes > 0 });
    } catch (error) {
      console.error(`Live server "${cfg.id}" logs/imports DELETE error`, error);
      res.status(500).json({ error: formatError(error) });
    }
  });

  router.put("/files/write", async (req: Request, res: Response) => {
    if (filesNotReady(res)) return;
    const body = req.body ?? {};
    const pathParam = typeof body.path === "string" ? body.path : "";
    const content = typeof body.content === "string" ? body.content : undefined;
    if (!pathParam.trim() || content === undefined) {
      res.status(400).json({ error: "path and content are required" });
      return;
    }
    try {
      await liveServerFilesWrite(cfg, pathParam, content);
      res.json({ ok: true });
    } catch (error) {
      console.error(`Live server "${cfg.id}" files write error`, error);
      res.status(502).json({ error: formatError(error) });
    }
  });

  return router;
}
