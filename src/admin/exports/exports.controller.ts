import { Request, Response } from "express";
import { z } from "zod";
import {
  createExportJob,
  findExportJob,
  toStatusDto,
} from "../../modules/export-job/export-job.service";
import { enqueueExportJob } from "./export.scheduler";
import { EXPORT_TYPES, isExportType } from "../../modules/export-job/export-job.registry";
import { getSignedDownloadUrl } from "../../utils/exportStorage";

const createExportSchema = z.object({
  type: z.string().min(1),
  format: z.enum(["csv", "excel"]).default("excel"),
  // The report's filter object (same params its list endpoint accepts, minus page/limit).
  filters: z.record(z.any()).optional().default({}),
});

const adminId = (req: Request): number | null => {
  const id = Number((req.user as any)?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const isSuperAdmin = (req: Request): boolean => (req.user as any)?.role === "super_admin";

// POST /api/v1/admin/exports — create a job, enqueue, return immediately (202).
export const createExport = async (req: Request, res: Response) => {
  try {
    const parsed = createExportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    }
    const { type, format, filters } = parsed.data;
    if (!isExportType(type)) {
      return res.status(422).json({ success: false, message: `Unsupported export type: ${type}`, supportedTypes: EXPORT_TYPES });
    }

    const job = await createExportJob({ type, format, filters, requestedBy: adminId(req) });
    await enqueueExportJob(job.jobRef);
    return res.status(202).json({ jobId: job.jobRef, status: "pending" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/admin/exports/:jobId — poll status (+ freshly-signed downloadUrl when ready).
export const getExport = async (req: Request, res: Response) => {
  try {
    const job = await findExportJob(req.params.jobId as string);
    if (!job) return res.status(404).json({ success: false, message: "Export job not found." });
    if (job.requestedBy != null && job.requestedBy !== adminId(req) && !isSuperAdmin(req)) {
      return res.status(403).json({ success: false, message: "You do not own this export job." });
    }
    return res.status(200).json(await toStatusDto(job));
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/admin/exports/:jobId/download — 302 to a fresh signed URL (alt to downloadUrl).
export const downloadExport = async (req: Request, res: Response) => {
  try {
    const job = await findExportJob(req.params.jobId as string);
    if (!job) return res.status(404).json({ success: false, message: "Export job not found." });
    if (job.requestedBy != null && job.requestedBy !== adminId(req) && !isSuperAdmin(req)) {
      return res.status(403).json({ success: false, message: "You do not own this export job." });
    }
    if (job.status === "failed") return res.status(409).json({ success: false, message: job.error ?? "Export failed." });
    if (job.status !== "ready" || !job.fileKey) return res.status(409).json({ success: false, message: "Export not ready yet." });
    if (job.expiresAt && job.expiresAt <= new Date()) return res.status(410).json({ success: false, message: "Export has expired." });
    const url = await getSignedDownloadUrl(job.fileKey, job.fileName ?? "export");
    return res.redirect(302, url);
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
