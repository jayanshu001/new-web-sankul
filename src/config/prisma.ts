// Prisma client: singleton plus timing, timestamp-fill, IST-shift and drift-log middleware.
import fs from "fs";
import path from "path";
import { PrismaClient, Prisma } from "@prisma/client";
import logger from "../utils/logger";
import { incrementContext } from "../utils/requestContext";
import { logPrismaSchemaDrift } from "../utils/prismaSchemaDrift";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaTimingInstalled?: boolean;
  prismaTimestampsInstalled?: boolean;
  prismaIstShiftInstalled?: boolean;
  prismaDriftLogInstalled?: boolean;
};

// The introspected schema has no `@default(now())`/`@updatedAt` on most
// created/updated columns, so they would land NULL; the DB's CURRENT_TIMESTAMP
// default would bypass the IST shift. They are filled centrally in the args
// instead. Map built once from the DMMF, covering the createdAt/created_at/createAt
// and updatedAt/updated_at variants; business timestamps are excluded.
const CREATED_TS = new Set(["createdAt", "created_at", "createAt"]);
const UPDATED_TS = new Set(["updatedAt", "updated_at"]);
const tsFields: Record<string, { created: string[]; updated: string[] }> = {};
for (const m of Prisma.dmmf.datamodel.models) {
  const created = m.fields.filter((f) => f.type === "DateTime" && CREATED_TS.has(f.name)).map((f) => f.name);
  const updated = m.fields.filter((f) => f.type === "DateTime" && UPDATED_TS.has(f.name)).map((f) => f.name);
  if (created.length || updated.length) tsFields[m.name] = { created, updated };
}

function fillTs(obj: any, fields: string[], now: Date): void {
  if (!obj || typeof obj !== "object") return;
  for (const f of fields) if (obj[f] === undefined) obj[f] = now;
}

// Timestamps are stored as IST wall-clock in the DB while the app works in UTC.
// This middleware is the only bridge: Date args are shifted +5:30 on write and
// results -5:30 on read. Raw `$queryRaw`/`$executeRaw` bypass it and must handle
// IST columns themselves.
const IST_SHIFT_MS = 5.5 * 60 * 60 * 1000; // India has no DST

/**
 * Copy of `value` with every Date shifted by `ms`. Recurses only into plain
 * objects and arrays so Decimal, BigInt, Buffer etc. are never corrupted.
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
  return value;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.PRISMA_LOG_QUERIES === "true"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  });

// Per-request `dbMs` timing (no-op outside an HTTP request). Each middleware is
// guarded so dev hot-reload doesn't stack duplicates on the reused singleton.
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

// Installed before the IST shift so it runs outer: it fills the args, then the
// shift converts those Dates to IST.
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

// IST bridge, installed after timing and timestamps so it runs innermost,
// closest to the DB.
if (!globalForPrisma.prismaIstShiftInstalled) {
  prisma.$use(async (params, next) => {
    if (params.args) params.args = shiftDates(params.args, IST_SHIFT_MS);
    const result = await next(params);
    return shiftDates(result, -IST_SHIFT_MS);
  });
  globalForPrisma.prismaIstShiftInstalled = true;
}

// Schema-drift diagnostics, installed last so it sees errors exactly as callers
// do. It only logs which fault occurred (stale client vs unapplied DDL); the
// error is rethrown untouched. Softening it to a non-5xx would be harmful, e.g.
// /client/downloads/encryption-key treats 404 as "mint a new key" and would
// orphan a user's downloaded files.
if (!globalForPrisma.prismaDriftLogInstalled) {
  prisma.$use(async (params, next) => {
    try {
      return await next(params);
    } catch (err) {
      logPrismaSchemaDrift(err, {
        model: params.model,
        action: params.action,
      });
      throw err;
    }
  });
  globalForPrisma.prismaDriftLogInstalled = true;
}

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Boot warning for a stale generated client: `prisma generate` writes into
 * node_modules, which does not trip `tsx watch`, so a running dev server keeps
 * the old client and 500s on new fields. Warn-only and non-production-only, since
 * a fresh install can legitimately skew mtimes and this must never block a deploy.
 */
const warnIfGeneratedClientIsStale = (): void => {
  if (process.env.NODE_ENV === "production") return;
  try {
    const schemaPath = path.resolve(process.cwd(), "prisma", "schema.prisma");
    const clientPath = path.resolve(
      process.cwd(),
      "node_modules",
      ".prisma",
      "client",
      "index.d.ts"
    );
    const schemaAt = fs.statSync(schemaPath).mtimeMs;
    const clientAt = fs.statSync(clientPath).mtimeMs;
    if (schemaAt > clientAt) {
      logger.warn(
        "PRISMA CLIENT MAY BE STALE — prisma/schema.prisma is newer than the generated client. " +
          "Queries against newly added fields will fail with PrismaClientValidationError (HTTP 500) " +
          "even though the database is fine. FIX: run `yarn prisma:generate`, then restart this process.",
        {
          schemaModifiedAt: new Date(schemaAt).toISOString(),
          clientGeneratedAt: new Date(clientAt).toISOString(),
        }
      );
    }
  } catch {
    // Convenience check only; never fatal.
  }
};

export const connectPrisma = async (): Promise<void> => {
  try {
    await prisma.$connect();
    logger.info("MySQL connected (Prisma).");
    warnIfGeneratedClientIsStale();
  } catch (error) {
    logger.error("MySQL (Prisma) connection error:", error);
    throw error;
  }
};

export const disconnectPrisma = async (): Promise<void> => {
  await prisma.$disconnect();
};

export default prisma;
