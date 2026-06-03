/**
 * Phase 1 — verify MySQL + Prisma against the imported staging dump.
 *
 * Usage:
 *   yarn db:verify
 *
 * Requires DATABASE_URL in .env (see .env.example).
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const main = async () => {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("Missing DATABASE_URL. Copy .env.example → .env and set MySQL URL.");
    process.exit(1);
  }

  const { prisma, disconnectPrisma } = await import("../src/config/prisma.ts");

  try {
    await prisma.$connect();
    const [{ db }] = await prisma.$queryRaw<[{ db: string }]>`SELECT DATABASE() AS db`;
    const tables = await prisma.$queryRaw<[{ table_count: bigint }]>`
      SELECT COUNT(*) AS table_count
      FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name LIKE 'ws_%'
    `;
    const customers = await prisma.customer.count();
    const packages = await prisma.package.count();

    console.log("MySQL connection: OK");
    console.log(`Active database: ${db}`);
    console.log(`ws_* tables: ${tables[0]?.table_count ?? 0}`);
    console.log(`ws_customer rows: ${customers}`);
    console.log(`ws_package rows (Package model): ${packages}`);
  } catch (err) {
    console.error("MySQL verification failed:", err);
    process.exit(1);
  } finally {
    await disconnectPrisma();
  }
};

main();
