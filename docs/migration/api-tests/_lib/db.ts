/**
 * DB access for the migration API tests.
 *
 * POST/PUT tests often need a real foreign key (a real package id, course id,
 * customer id, …) for the request body to validate. Hardcoding ids rots and
 * causes FK/validation failures. These helpers pull real rows from MySQL so
 * write payloads reference data that actually exists.
 *
 * Uses a dedicated PrismaClient (DATABASE_URL from .env). Call `closeDb()` at
 * the end of a run, or rely on process exit.
 */
import { PrismaClient } from "@prisma/client";
import { config } from "./env.js";

let client: PrismaClient | null = null;

export function db(): PrismaClient {
  if (!client) {
    client = new PrismaClient({ log: ["warn", "error"] });
  }
  return client;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}

/** Run raw SQL and return rows — escape hatch for tables without a Prisma model. */
export async function query<T = Record<string, unknown>>(
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  return db().$queryRawUnsafe<T[]>(sql, ...params);
}

/** Convenience: the int customer id the mock JWT represents, if you need to seed per-customer rows. */
export const mockCustomerId = Number(process.env.MIGRATION_TEST_CUSTOMER_INT_ID ?? "0") || null;

void config; // keep env loaded (side-effect import order)
