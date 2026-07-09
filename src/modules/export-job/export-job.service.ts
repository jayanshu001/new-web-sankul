import { randomUUID } from "crypto";
import { exportJobRepository as repo } from "./export-job.repository";
import { getExportDef, extFor, contentTypeFor, ExportFormat } from "./export-job.registry";
import {
  uploadExportObject,
  deleteExportObject,
  getSignedDownloadUrl,
} from "../../utils/exportStorage";

// How long a generated file (and thus its download link) stays valid before GC.
const RETENTION_MS = (Number(process.env.EXPORT_RETENTION_MINUTES) || 45) * 60_000;
export const EXPORT_RETENTION_MS = RETENTION_MS;

const newRef = () => `exp_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
const dateStamp = (d: Date) => d.toISOString().slice(0, 10);

// FE `filters` may arrive with numeric/boolean values; the report parsers all read
// Record<string,string>. Normalize to strings and drop empties so every parser
// behaves exactly as it does for the sync ?query endpoints.
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

// Poll DTO. Signs a fresh short-lived download URL each call while the file is live
// (status=ready, key present, not past expiry) — the object is private.
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

// Worker entrypoint: generate the file, upload private, mark ready. Idempotent —
// a re-run of an already-finished job is a no-op. Throws on failure so BullMQ can
// retry; the row is also flipped to failed so the poller stops.
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
    const buffer = await def.build((job.params ?? {}) as Record<string, string>, fmt);
    const ext = extFor(fmt);
    const now = new Date();
    const fileName = `${def.filenameBase}-${dateStamp(now)}.${ext}`;
    const key = `admin/exports/${job.type}/${job.jobRef}.${ext}`;
    await uploadExportObject(key, buffer, contentTypeFor(fmt), fileName);
    const expiresAt = new Date(now.getTime() + RETENTION_MS);
    await repo.update(job.id, {
      status: "ready",
      progress: 100,
      fileKey: key,
      fileName,
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

// Retention GC: delete the stored object + null the key so a late poll returns no
// downloadUrl. Status stays "ready" (the job did succeed — the file just expired).
export const expireExportJob = async (jobRef: string): Promise<void> => {
  const job = await repo.findByRef(jobRef);
  if (!job || !job.fileKey) return;
  await deleteExportObject(job.fileKey);
  await repo.update(job.id, { fileKey: null, updatedAt: new Date() });
};

// Boot rehydrate: requeue jobs a crashed worker left in "processing". Returns the
// refs to re-enqueue.
export const rehydrateExportJobs = async (): Promise<string[]> => {
  const stuck = await repo.stuckProcessing();
  await Promise.all(stuck.map((j) => repo.update(j.id, { status: "pending", progress: 0, updatedAt: new Date() })));
  return stuck.map((j) => j.jobRef);
};
