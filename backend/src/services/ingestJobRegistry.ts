import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import type { LiveServerConfig } from "../config";
import { ingestRemoteGzLog } from "./logIngest";

export type IngestFileStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface IngestFileState {
  file: string;
  status: IngestFileStatus;
  eventCount: number | null;
  durationMs: number | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export type IngestJobStatus = "pending" | "running" | "completed" | "failed";

export interface IngestJob {
  id: string;
  serverId: string;
  status: IngestJobStatus;
  startedAt: string;
  finishedAt: string | null;
  files: IngestFileState[];
}

interface JobInternal {
  job: IngestJob;
  events: EventEmitter;
}

const RETENTION_MS = 60 * 60 * 1000;

class IngestJobRegistry {
  private jobs = new Map<string, JobInternal>();

  /**
   * Start a sequential ingest of one or more files for the given server.
   * Returns immediately with a job snapshot; progress is observable via
   * {@link get} or {@link subscribe}.
   */
  start(cfg: LiveServerConfig, files: string[]): IngestJob {
    const id = randomUUID();
    const job: IngestJob = {
      id,
      serverId: cfg.id,
      status: "pending",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      files: files.map((file) => ({
        file,
        status: "pending",
        eventCount: null,
        durationMs: null,
        error: null,
        startedAt: null,
        finishedAt: null,
      })),
    };
    const internal: JobInternal = { job, events: new EventEmitter() };
    this.jobs.set(id, internal);

    void this.run(cfg, internal).catch((err) => {
      console.error(`Ingest job ${id} crashed`, err);
    });

    return this.snapshot(id) ?? job;
  }

  get(id: string): IngestJob | null {
    return this.snapshot(id);
  }

  subscribe(id: string, handler: (job: IngestJob) => void): (() => void) | null {
    const internal = this.jobs.get(id);
    if (!internal) return null;
    const listener = () => {
      const snap = this.snapshot(id);
      if (snap) handler(snap);
    };
    internal.events.on("change", listener);
    listener();
    return () => internal.events.off("change", listener);
  }

  private snapshot(id: string): IngestJob | null {
    const internal = this.jobs.get(id);
    if (!internal) return null;
    return {
      ...internal.job,
      files: internal.job.files.map((f) => ({ ...f })),
    };
  }

  private emit(internal: JobInternal): void {
    internal.events.emit("change");
  }

  private async run(cfg: LiveServerConfig, internal: JobInternal): Promise<void> {
    const { job } = internal;
    job.status = "running";
    this.emit(internal);

    let anyFailed = false;
    for (const file of job.files) {
      file.status = "running";
      file.startedAt = new Date().toISOString();
      this.emit(internal);
      try {
        const result = await ingestRemoteGzLog(cfg, file.file);
        file.status = "completed";
        file.eventCount = result.eventCount;
        file.durationMs = result.durationMs;
        file.finishedAt = new Date().toISOString();
      } catch (error) {
        anyFailed = true;
        file.status = "failed";
        file.error = error instanceof Error ? error.message : String(error);
        file.finishedAt = new Date().toISOString();
      }
      this.emit(internal);
    }

    job.status = anyFailed ? "failed" : "completed";
    job.finishedAt = new Date().toISOString();
    this.emit(internal);

    setTimeout(() => {
      this.jobs.delete(job.id);
      internal.events.removeAllListeners();
    }, RETENTION_MS);
  }
}

export const ingestJobs = new IngestJobRegistry();
