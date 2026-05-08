import type { Request, Response } from "express";
import { Router } from "express";
import { randomUUID } from "crypto";
import { homedir } from "os";
import { join } from "path";
import {
  TELEDOSI_RCON_NOT_CONFIGURED_MESSAGE,
  TELEDOSI_FILES_NOT_CONFIGURED_MESSAGE,
  TELEDOSI_NOT_CONFIGURED_MESSAGE,
  isTeledosiConfigured,
  isTeledosiFilesConfigured,
  isTeledosiRconConfigured,
  isTeledosiSshConfigured,
  teledosiFilesMaxBytes,
  teledosiSftpRemoteRoot,
} from "../config";
import {
  connectTeledosiClient,
  getTeledosiRecentLogs,
  getTeledosiStatus,
  streamTeledosiJournalFollow,
  teledosiSystemctl,
} from "../services/teledosiRemote";
import {
  teledosiFilesList,
  TeledosiFileTooLargeError,
  TeledosiBackupCancelledError,
  teledosiBackupsList,
  teledosiBackupCreateReadStream,
  teledosiBackupDownloadToLocalWithProgress,
  teledosiFilesRead,
  teledosiFilesWrite,
} from "../services/teledosiFiles";
import { executeTeledosiRconCommand, TeledosiRconError } from "../services/rconClient";

const router = Router();
type BackupDownloadJob = {
  id: string;
  fileName: string;
  localPath: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  error?: string;
  downloadedBytes: number;
  totalBytes?: number;
  speedBytesPerSec?: number;
  etaSeconds?: number;
  startedAt: string;
  finishedAt?: string;
  cancelRequested: boolean;
};
const backupDownloadJobs = new Map<string, BackupDownloadJob>();
const backupDownloadCancels = new Map<string, () => void>();

function notConfigured(res: Response): boolean {
  if (isTeledosiConfigured()) {
    return false;
  }
  res.status(503).json({ error: TELEDOSI_NOT_CONFIGURED_MESSAGE });
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
    const { state, raw } = await getTeledosiStatus();
    res.json({ state, raw });
  } catch (error) {
    console.error("Teledosi status error", error);
    res.status(502).json({ error: formatError(error) });
  }
});

router.post("/start", async (_req: Request, res: Response) => {
  if (notConfigured(res)) return;
  try {
    const r = await teledosiSystemctl("start");
    const out = (r.stdout + r.stderr).trim();
    if (r.code !== 0) {
      res.status(502).json({ error: out || `systemctl exited with code ${r.code}` });
      return;
    }
    res.json({ ok: true, output: out || undefined });
  } catch (error) {
    console.error("Teledosi start error", error);
    res.status(502).json({ error: formatError(error) });
  }
});

router.post("/stop", async (_req: Request, res: Response) => {
  if (notConfigured(res)) return;
  try {
    const r = await teledosiSystemctl("stop");
    const out = (r.stdout + r.stderr).trim();
    if (r.code !== 0) {
      res.status(502).json({ error: out || `systemctl exited with code ${r.code}` });
      return;
    }
    res.json({ ok: true, output: out || undefined });
  } catch (error) {
    console.error("Teledosi stop error", error);
    res.status(502).json({ error: formatError(error) });
  }
});

router.post("/restart", async (_req: Request, res: Response) => {
  if (notConfigured(res)) return;
  try {
    const r = await teledosiSystemctl("restart");
    const out = (r.stdout + r.stderr).trim();
    if (r.code !== 0) {
      res.status(502).json({ error: out || `systemctl exited with code ${r.code}` });
      return;
    }
    res.json({ ok: true, output: out || undefined });
  } catch (error) {
    console.error("Teledosi restart error", error);
    res.status(502).json({ error: formatError(error) });
  }
});

router.post("/command", async (req: Request, res: Response) => {
  const command = typeof req.body?.command === "string" ? req.body.command.trim() : "";
  if (!command) {
    res.status(400).json({ error: "Command is required" });
    return;
  }
  if (!isTeledosiRconConfigured()) {
    res.status(503).json({ error: TELEDOSI_RCON_NOT_CONFIGURED_MESSAGE });
    return;
  }
  try {
    const { response } = await executeTeledosiRconCommand(command);
    res.json({ ok: true, response });
  } catch (error) {
    if (error instanceof TeledosiRconError) {
      if (error.code === "NOT_CONFIGURED") {
        res.status(503).json({ error: TELEDOSI_RCON_NOT_CONFIGURED_MESSAGE });
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
    console.error("Teledosi RCON command error", error);
    res.status(500).json({ error: formatError(error) });
  }
});

router.get("/logs", async (req: Request, res: Response) => {
  if (notConfigured(res)) return;
  const linesParam = typeof req.query.lines === "string" ? Number(req.query.lines) : undefined;
  try {
    const text = await getTeledosiRecentLogs(linesParam);
    res.json({ text });
  } catch (error) {
    console.error("Teledosi logs error", error);
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

  let conn: Awaited<ReturnType<typeof connectTeledosiClient>>;
  try {
    conn = await connectTeledosiClient();
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

  streamTeledosiJournalFollow(
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
    filesConfigured: isTeledosiFilesConfigured(),
    remoteRoot: isTeledosiFilesConfigured() ? teledosiSftpRemoteRoot : undefined,
    maxBytes: teledosiFilesMaxBytes,
    hint: isTeledosiFilesConfigured()
      ? undefined
      : isTeledosiSshConfigured()
        ? TELEDOSI_FILES_NOT_CONFIGURED_MESSAGE
        : TELEDOSI_NOT_CONFIGURED_MESSAGE,
  });
});

function filesNotReady(res: Response): boolean {
  if (isTeledosiFilesConfigured()) {
    return false;
  }
  res.status(503).json({
    error: isTeledosiSshConfigured()
      ? TELEDOSI_FILES_NOT_CONFIGURED_MESSAGE
      : TELEDOSI_NOT_CONFIGURED_MESSAGE,
  });
  return true;
}

function backupsNotReady(res: Response): boolean {
  if (isTeledosiSshConfigured()) {
    return false;
  }
  res.status(503).json({
    error: TELEDOSI_NOT_CONFIGURED_MESSAGE,
  });
  return true;
}

router.get("/files/list", async (req: Request, res: Response) => {
  if (filesNotReady(res)) return;
  const pathParam = typeof req.query.path === "string" ? req.query.path : "";
  try {
    const entries = await teledosiFilesList(pathParam);
    res.json({ entries });
  } catch (error) {
    console.error("Teledosi files list error", error);
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
    const { content, isBinary } = await teledosiFilesRead(pathParam);
    res.json({ path: pathParam, content, isBinary });
  } catch (error) {
    console.error("Teledosi files read error", error);
    if (error instanceof TeledosiFileTooLargeError) {
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
    await teledosiFilesWrite(pathParam, content);
    res.json({ ok: true });
  } catch (error) {
    console.error("Teledosi files write error", error);
    res.status(502).json({ error: formatError(error) });
  }
});

router.get("/backups/list", async (_req: Request, res: Response) => {
  if (backupsNotReady(res)) return;
  try {
    const entries = await teledosiBackupsList();
    res.json({ entries });
  } catch (error) {
    console.error("Teledosi backups list error", error);
    res.status(502).json({ error: formatError(error) });
  }
});

router.get("/backups/download", async (req: Request, res: Response) => {
  if (backupsNotReady(res)) return;
  const fileName = typeof req.query.file === "string" ? req.query.file : "";
  if (!fileName.trim()) {
    res.status(400).json({ error: "file query parameter is required" });
    return;
  }
  try {
    const { stream, close } = await teledosiBackupCreateReadStream(fileName);
    const safeFileName = fileName.replace(/["\\]/g, "_");
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFileName}"`);
    res.on("close", close);
    req.on("aborted", close);
    stream.on("error", (error) => {
      console.error("Teledosi backup stream error", error);
      if (!res.headersSent) {
        res.status(502).json({ error: formatError(error) });
      } else {
        res.destroy(error instanceof Error ? error : new Error(String(error)));
      }
      close();
    });
    stream.pipe(res);
  } catch (error) {
    console.error("Teledosi backup download error", error);
    res.status(502).json({ error: formatError(error) });
  }
});

router.post("/backups/download-local", async (req: Request, res: Response) => {
  if (backupsNotReady(res)) return;
  const fileName = typeof req.body?.file === "string" ? req.body.file : "";
  if (!fileName.trim()) {
    res.status(400).json({ error: "file is required" });
    return;
  }
  try {
    const downloadsDir = join(homedir(), "Downloads");
    const safeLocalName = fileName
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .trim();
    if (!safeLocalName) {
      res.status(400).json({ error: "Invalid file name" });
      return;
    }
    const localPath = join(downloadsDir, safeLocalName);
    const id = randomUUID();
    const job: BackupDownloadJob = {
      id,
      fileName,
      localPath,
      status: "pending",
      downloadedBytes: 0,
      startedAt: new Date().toISOString(),
      cancelRequested: false,
    };
    backupDownloadJobs.set(id, job);
    backupDownloadCancels.set(id, () => {
      job.cancelRequested = true;
    });
    void (async () => {
      job.status = "running";
      const samples: Array<{ t: number; bytes: number }> = [];
      try {
        await teledosiBackupDownloadToLocalWithProgress(
          fileName,
          localPath,
          (downloaded, total) => {
            const now = Date.now();
            job.downloadedBytes = downloaded;
            if (typeof total === "number") {
              job.totalBytes = total;
            }
            samples.push({ t: now, bytes: downloaded });
            while (samples.length > 1 && now - samples[0].t > 8000) {
              samples.shift();
            }
            if (samples.length > 1) {
              const first = samples[0];
              const last = samples[samples.length - 1];
              const dtSec = Math.max(0.001, (last.t - first.t) / 1000);
              const db = Math.max(0, last.bytes - first.bytes);
              const speed = db / dtSec;
              job.speedBytesPerSec = Number.isFinite(speed) ? speed : undefined;
              if (
                typeof job.totalBytes === "number" &&
                job.totalBytes >= downloaded &&
                job.speedBytesPerSec &&
                job.speedBytesPerSec > 0
              ) {
                job.etaSeconds = (job.totalBytes - downloaded) / job.speedBytesPerSec;
              } else {
                job.etaSeconds = undefined;
              }
            }
          },
          () => job.cancelRequested,
        );
        job.status = "completed";
        job.finishedAt = new Date().toISOString();
      } catch (error) {
        if (error instanceof TeledosiBackupCancelledError || job.cancelRequested) {
          job.status = "cancelled";
          job.error = undefined;
        } else {
          job.status = "failed";
          job.error = formatError(error);
        }
        job.finishedAt = new Date().toISOString();
      } finally {
        backupDownloadCancels.delete(id);
      }
    })();
    res.json({ ok: true, jobId: id, localPath });
  } catch (error) {
    console.error("Teledosi backup local download error", error);
    res.status(502).json({ error: formatError(error) });
  }
});

router.get("/backups/download-local/:jobId", (req: Request, res: Response) => {
  if (backupsNotReady(res)) return;
  const jobId = typeof req.params.jobId === "string" ? req.params.jobId : "";
  const job = backupDownloadJobs.get(jobId);
  if (!job) {
    res.status(404).json({ error: "Backup download job not found" });
    return;
  }
  res.json({ job });
});

router.post("/backups/download-local/:jobId/cancel", (req: Request, res: Response) => {
  if (backupsNotReady(res)) return;
  const jobId = typeof req.params.jobId === "string" ? req.params.jobId : "";
  const job = backupDownloadJobs.get(jobId);
  if (!job) {
    res.status(404).json({ error: "Backup download job not found" });
    return;
  }
  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    res.json({ ok: true, alreadyFinished: true });
    return;
  }
  job.cancelRequested = true;
  backupDownloadCancels.get(jobId)?.();
  res.json({ ok: true });
});

export default router;
