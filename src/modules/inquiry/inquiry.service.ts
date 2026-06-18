/**
 * Inquiry — MySQL (Prisma) branch. Wave 8. ws_website_inquiry ALTERed to add
 * customer_id / description / message / source (DDL 2026-06-18_create_wave8_misc_tables.sql).
 *
 * Gated behind `isMysqlModule("inquiry")`. Admin list/get/delete + client submit.
 * customer populate hydrates from ws_customer (full_name split → first/last,
 * phoneNumber, emailAddress) to mirror the Mongo .populate("customerId",
 * "_id firstName lastName phoneNumber email").
 */
import { isMysqlModule } from "../../config/migration";
import { prisma } from "../../config/prisma";

export const INQUIRY_MODULE = "inquiry";
export const isInquiryMysql = (): boolean => isMysqlModule(INQUIRY_MODULE);

export const parseInquiryId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const COURSES = new Set(["UPSC","GPSC","STI","DYSO","RFO","PI","PSI","Constable","CCE","Talati","Forest","TET_TAT","FHW_MPHW"]);
const MODES = new Set(["online","offline"]);

const dto = (r: any) => ({
  _id: String(r.id),
  customerId: r.customer
    ? {
        _id: String(r.customer.id),
        firstName: r.customer._firstName ?? null,
        lastName: r.customer._lastName ?? null,
        phoneNumber: r.customer.phoneNumber ?? null,
        email: r.customer.emailAddress ?? null,
      }
    : (r.customerId != null ? String(r.customerId) : null),
  description: r.description ?? null,
  name: r.name ?? null,
  mobile: r.mobile ?? null,
  email: r.email ?? null,
  city: r.city ?? null,
  course: r.course ?? null,
  mode: r.mode ?? null,
  message: r.message ?? null,
  source: r.source ?? null,
  createdAt: r.createdAt ?? null,
  updatedAt: r.updatedAt ?? null,
});

/** Hydrate customer refs (full_name → first/last split) for a set of rows. */
const hydrateCustomers = async (rows: any[]) => {
  const ids = [...new Set(rows.map((r) => r.customerId).filter((x): x is number => x != null && x > 0))];
  if (!ids.length) return rows.map((r) => ({ ...r, customer: null }));
  const customers = await prisma.customer.findMany({
    where: { id: { in: ids } },
    select: { id: true, fullName: true, phoneNumber: true, emailAddress: true },
  });
  const byId = new Map(customers.map((c) => {
    const parts = (c.fullName ?? "").trim().split(/\s+/).filter(Boolean);
    const _firstName = parts.length ? parts[0] : null;
    const _lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
    return [c.id, { ...c, _firstName, _lastName }];
  }));
  return rows.map((r) => ({ ...r, customer: r.customerId != null ? byId.get(r.customerId) ?? null : null }));
};

export const listInquiries = async (opts: {
  search?: string; course?: string; mode?: string; from?: Date; to?: Date; page: number; limit: number;
}): Promise<{ data: any[]; total: number }> => {
  const where: any = {};
  if (opts.course && COURSES.has(opts.course)) where.course = opts.course;
  if (opts.mode && MODES.has(opts.mode)) where.mode = opts.mode;
  if (opts.search && opts.search.trim()) {
    const s = opts.search.trim();
    where.OR = [
      { description: { contains: s } }, { name: { contains: s } },
      { mobile: { contains: s } }, { email: { contains: s } },
    ];
  }
  if (opts.from || opts.to) {
    where.createdAt = {};
    if (opts.from) where.createdAt.gte = opts.from;
    if (opts.to) where.createdAt.lte = opts.to;
  }
  const skip = (opts.page - 1) * opts.limit;
  const [rows, total] = await Promise.all([
    prisma.inquiry.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: opts.limit }),
    prisma.inquiry.count({ where }),
  ]);
  const hydrated = await hydrateCustomers(rows);
  return { data: hydrated.map(dto), total };
};

export const getInquiry = async (id: number): Promise<any | null> => {
  const row = await prisma.inquiry.findUnique({ where: { id } });
  if (!row) return null;
  const [h] = await hydrateCustomers([row]);
  return dto(h);
};

export const deleteInquiry = async (id: number): Promise<boolean> => {
  const exists = await prisma.inquiry.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return false;
  await prisma.inquiry.delete({ where: { id } });
  return true;
};

/** Client submit: { customerId, description } (matches the Mongo client path). */
export const submitInquiry = async (customerId: number, description: string): Promise<any> => {
  const now = new Date();
  const row = await prisma.inquiry.create({
    data: { customerId, description, source: "app", createdAt: now, updatedAt: now },
  });
  return dto({ ...row, customer: null });
};
