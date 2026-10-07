// Async exports: job create, worker run, status polling, expiry and rehydrate.
import { randomUUID } from "crypto";
import { exportJobRepository as repo } from "./export-job.repository";
import { getExportDef, extFor, contentTypeFor, ExportFormat } from "./export-job.registry";
import {
  uploadExportObject,
  createExportUpload,
  deleteExportObject,
  getSignedDownloadUrl,
} from "../../utils/exportStorage";
import { streamReportToWritable } from "../../utils/reportStream";

// How long a generated file (and thus its download link) stays valid before GC.
const RETENTION_MS = (Number(process.env.EXPORT_RETENTION_MINUTES) || 45) * 60_000;
export const EXPORT_RETENTION_MS = RETENTION_MS;

const newRef = () => `exp_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
const dateStamp = (d: Date) => d.toISOString().slice(0, 10);

// Report parsers read Record<string,string>; normalize FE values so they behave as
// they do for the sync ?query endpoints.
const stringifyFilters = (f: Record<string, any> | null | undefined): Record<string, string> =>
  Object.fromEntries(
    Object.entries(f ?? {})
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => [k, String(v)])
  );

export interface CreateExportInput {
  type: string;
  format: ExportFormat;
  filters: Record<string, any>;
  requestedBy: number | null;
}

// Persist a pending job; filters are stringified like the sync ?query endpoints.
export const createExportJob = async (input: CreateExportInput) => {
  const now = new Date();
  return repo.create({
    jobRef: newRef(),
    type: input.type,
    format: input.format,
    params: stringifyFilters(input.filters) as any,
    status: "pending",
    progress: 0,
    requestedBy: input.requestedBy ?? null,
    createdAt: now,
    updatedAt: now,
  });
};

export const findExportJob = (jobRef: string) => repo.findByRef(jobRef);

// The object is private, so each poll signs a fresh short-lived URL while the file is live.
export const toStatusDto = async (job: NonNullable<Awaited<ReturnType<typeof repo.findByRef>>>) => {
  const live = job.status === "ready" && !!job.fileKey && (!job.expiresAt || job.expiresAt > new Date());
  const downloadUrl = live && job.fileKey ? await getSignedDownloadUrl(job.fileKey, job.fileName ?? "export") : null;
  return {
    jobId: job.jobRef,
    status: job.status,
    progress: (job.progress ?? 0) / 100, // 0..1 for a progress bar
    rowCount: job.rowCount ?? null,
    downloadUrl,
    fileName: job.fileName ?? null,
    error: job.error ?? null,
    expiresAt: job.expiresAt ?? null,
  };
};

// Worker entrypoint. Idempotent: re-running a finished job is a no-op. Throws on
// failure so BullMQ retries; the row is also flipped to failed so the poller stops.
export const runExportJob = async (jobRef: string): Promise<void> => {
  const job = await repo.findByRef(jobRef);
  if (!job) return;
  if (job.status === "ready" || job.status === "failed") return;

  const def = getExportDef(job.type);
  if (!def) {
    await repo.update(job.id, { status: "failed", error: `Unsupported export type: ${job.type}`, finishedAt: new Date(), updatedAt: new Date() });
    return;
  }

  await repo.update(job.id, { status: "processing", progress: 10, startedAt: new Date(), updatedAt: new Date() });
  try {
    const fmt: ExportFormat = job.format === "csv" ? "csv" : "excel";
    const params = (job.params ?? {}) as Record<string, string>;
    const ext = extFor(fmt);
    const now = new Date();
    const fileName = `${def.filenameBase}-${dateStamp(now)}.${ext}`;
    const key = `admin/exports/${job.type}/${job.jobRef}.${ext}`;

    let rowCount: number | null = null;
    if (def.resolveSource) {
      const source = await def.resolveSource(params); // may throw on a bad filter

      // Progress is rows/total when the source can count, else a monotonic ramp
      // toward 0.95; "ready" sets 100. Persisted every PERSIST_EVERY rows so polling
      // sees movement without hammering the DB. Writes are awaited in the stream
      // loop, so they all settle before the ready write.
      const total = source.countTotal ? await source.countTotal().catch(() => null) : null;
      if (total != null) {
        await repo.update(job.id, { rowCount: total, updatedAt: new Date() }); // seed "of N"
      }
      const PERSIST_EVERY = 5_000;
      let lastPersisted = 0;
      const onProgress = async (rows: number): Promise<void> => {
        if (rows - lastPersisted < PERSIST_EVERY) return;
        lastPersisted = rows;
        const frac =
          total && total > 0
            ? Math.min(0.95, rows / total)
            : Math.min(0.95, 0.1 + 0.85 * (1 - Math.exp(-rows / 50_000)));
        await repo.update(job.id, { progress: Math.round(frac * 100), rowCount: rows, updatedAt: new Date() });
      };

      const upload = createExportUpload(key, contentTypeFor(fmt), fileName);
      try {
        rowCount = await streamReportToWritable(source, fmt, upload.body, onProgress);
      } catch (err) {
        upload.body.destroy(err as Error); // abort the multipart upload
        throw err;
      }
      await upload.done;
    } else if (def.build) {
      const buffer = await def.build(params, fmt);
      await uploadExportObject(key, buffer, contentTypeFor(fmt), fileName);
    } else {
      throw new Error(`Export type ${job.type} has no builder.`);
    }

    const expiresAt = new Date(now.getTime() + RETENTION_MS);
    await repo.update(job.id, {
      status: "ready",
      progress: 100,
      fileKey: key,
      fileName,
      rowCount,
      expiresAt,
      finishedAt: now,
      updatedAt: now,
    });
  } catch (err: any) {
    await repo.update(job.id, {
      status: "failed",
      error: String(err?.message ?? err).slice(0, 1000),
      finishedAt: new Date(),
      updatedAt: new Date(),
    });
    throw err;
  }
};

// Retention GC: a late poll gets no downloadUrl. Status stays "ready" (the job succeeded).
export const expireExportJob = async (jobRef: string): Promise<void> => {
  const job = await repo.findByRef(jobRef);
  if (!job || !job.fileKey) return;
  await deleteExportObject(job.fileKey);
  await repo.update(job.id, { fileKey: null, updatedAt: new Date() });
};

// Boot rehydrate: returns refs of jobs a crashed worker left in "processing".
export const rehydrateExportJobs = async (): Promise<string[]> => {
  const stuck = await repo.stuckProcessing();
  await Promise.all(stuck.map((j) => repo.update(j.id, { status: "pending", progress: 0, updatedAt: new Date() })));
  return stuck.map((j) => j.jobRef);
};
