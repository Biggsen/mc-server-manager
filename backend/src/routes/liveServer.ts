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
