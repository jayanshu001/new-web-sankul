import { PrismaClient, Prisma } from "@prisma/client";
import logger from "../utils/logger";
import { incrementContext } from "../utils/requestContext";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaTimingInstalled?: boolean;
  prismaTimestampsInstalled?: boolean;
  prismaIstShiftInstalled?: boolean;
};

// ── Auto-populate created/updated timestamps ────────────────────────────────
// The schema is INTROSPECTED, so most created_at/updated_at columns have neither
// `@default(now())` nor `@updatedAt` — Prisma never sets them, so unless a caller
// passes them explicitly they land NULL (e.g. ws_customer.created_at). Relying on
// the DB's `DEFAULT CURRENT_TIMESTAMP` is also wrong now: it uses the DB session
// tz and bypasses the IST write-shift. So we set them centrally, in the args, so
// the value flows through the IST shift and every table is consistent.
//
// Built once from the DMMF: model → its DateTime created/updated field names
// (handles the createdAt / created_at / createAt and updatedAt / updated_at
// naming variants). Business timestamps (startAt, expiresAt, …) are excluded.
const CREATED_TS = new Set(["createdAt", "created_at", "createAt"]);
const UPDATED_TS = new Set(["updatedAt", "updated_at"]);
const tsFields: Record<string, { created: string[]; updated: string[] }> = {};
for (const m of Prisma.dmmf.datamodel.models) {
  const created = m.fields.filter((f) => f.type === "DateTime" && CREATED_TS.has(f.name)).map((f) => f.name);
  const updated = m.fields.filter((f) => f.type === "DateTime" && UPDATED_TS.has(f.name)).map((f) => f.name);
  if (created.length || updated.length) tsFields[m.name] = { created, updated };
}

/** Set each field to `now` on `obj` only when the caller left it undefined. */
function fillTs(obj: any, fields: string[], now: Date): void {
  if (!obj || typeof obj !== "object") return;
  for (const f of fields) if (obj[f] === undefined) obj[f] = now;
}

// ── IST-in-DB shift ──────────────────────────────────────────────────────────
// Business requirement: timestamps are STORED as IST wall-clock in the DB (not
// UTC). The whole app layer still works in UTC — this middleware is the ONLY
// place that bridges the two, so filters/sorting/analytics and the IST response
// serializer stay unchanged:
//   • WRITE: shift every Date arg +5:30 so MySQL DATETIME columns hold IST.
//   • READ : shift every Date in the result -5:30 back to UTC for the app.
// Raw `$queryRaw`/`$executeRaw` bypass Prisma middleware and must handle the IST
// columns themselves. Existing rows must be backfilled +5:30 at cutover (they
// were written UTC) or reads would under-shift them.
const IST_SHIFT_MS = 5.5 * 60 * 60 * 1000; // +05:30, India has no DST

/**
 * Return a copy of `value` with every Date shifted by `ms`. Recurses ONLY into
 * plain objects and arrays — Decimal, BigInt, Buffer, etc. are left untouched so
 * non-date Prisma values are never corrupted.
 */
function shiftDates(value: any, ms: number): any {
  if (value instanceof Date) return new Date(value.getTime() + ms);
  if (Array.isArray(value)) return value.map((v) => shiftDates(v, ms));
  if (
    value !== null &&
    typeof value === "object" &&
    (value.constructor === Object || value.constructor === undefined)
  ) {
    const out: Record<string, any> = {};
    for (const k of Object.keys(value)) out[k] = shiftDates(value[k], ms);
    return out;
  }
  return value; // primitives, Decimal, BigInt, Buffer, Date-less objects
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.PRISMA_LOG_QUERIES === "true"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  });

// Query-timing middleware → per-request `dbMs` (restores the parity the retired
// Mongoose timing plugin used to provide). Outside an HTTP request (BullMQ
// workers, scripts) `incrementContext` is a no-op. Instrumentation ONLY — it never
// touches query params or results, so it cannot change any response. Guarded so
// dev hot-reload doesn't stack duplicate middleware on the reused singleton.
if (!globalForPrisma.prismaTimingInstalled) {
  prisma.$use(async (params, next) => {
    const start = process.hrtime.bigint();
    try {
      return await next(params);
    } finally {
      incrementContext("dbMs", Number(process.hrtime.bigint() - start) / 1_000_000);
    }
  });
  globalForPrisma.prismaTimingInstalled = true;
}

// Auto-populate created/updated timestamps. Installed BEFORE the IST shift so it
// runs OUTER — it fills the args, then the IST shift converts those Dates to IST.
if (!globalForPrisma.prismaTimestampsInstalled) {
  prisma.$use(async (params, next) => {
    const ts = params.model ? tsFields[params.model] : undefined;
    if (ts && params.args) {
      const now = new Date();
      const a = params.args;
      switch (params.action) {
        case "create":
          fillTs(a.data, ts.created, now);
          fillTs(a.data, ts.updated, now);
          break;
        case "createMany":
        case "createManyAndReturn":
          (Array.isArray(a.data) ? a.data : [a.data]).forEach((d: any) => {
            fillTs(d, ts.created, now);
            fillTs(d, ts.updated, now);
          });
          break;
        case "update":
        case "updateMany":
          fillTs(a.data, ts.updated, now);
          break;
        case "upsert":
          fillTs(a.create, ts.created, now);
          fillTs(a.create, ts.updated, now);
          fillTs(a.update, ts.updated, now);
          break;
      }
    }
    return next(params);
  });
  globalForPrisma.prismaTimestampsInstalled = true;
}

// IST-in-DB bridge (see shiftDates above). Installed AFTER timing so it runs
// innermost — closest to the DB — shifting args right before the query and
// results right after. Guarded against dev hot-reload double-install.
if (!globalForPrisma.prismaIstShiftInstalled) {
  prisma.$use(async (params, next) => {
    if (params.args) params.args = shiftDates(params.args, IST_SHIFT_MS);
    const result = await next(params);
    return shiftDates(result, -IST_SHIFT_MS);
  });
  globalForPrisma.prismaIstShiftInstalled = true;
}

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export const connectPrisma = async (): Promise<void> => {
  try {
    await prisma.$connect();
    logger.info("MySQL connected (Prisma).");
  } catch (error) {
    logger.error("MySQL (Prisma) connection error:", error);
    throw error;
  }
};

export const disconnectPrisma = async (): Promise<void> => {
  await prisma.$disconnect();
};

export default prisma;
