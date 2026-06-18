/**
 * Backfill ws_customer_device_token from Mongo Customer.firebaseTokens[].
 *
 * Prerequisite (a) for the `client-notification` consumer: SQL had no home for
 * the multi-device FCM token array. Creates the table (idempotent DDL) then
 * copies every (customer, token) pair across.
 *
 * Bridge: Mongo customer _id → ws_customers.phoneNumber → ws_customer.id (phone),
 * same as the Wave 7 backfill. `token` is globally UNIQUE: the last writer wins
 * (mirrors the Mongo token-keyed upsert), so we de-dup by token, newest first.
 *
 * Idempotent: re-creates the table if missing and wipes it before reinserting.
 *
 * Run: npx tsx scripts/backfill-customer-device-tokens.ts
 */
import "dotenv/config";
import mongoose from "mongoose";
import { prisma } from "../src/config/prisma";

function d(v: any) { return v ? new Date(v) : null; }

const DDL = `
CREATE TABLE IF NOT EXISTS \`ws_customer_device_token\` (
  \`id\`           INT NOT NULL AUTO_INCREMENT,
  \`customer_id\`  INT NOT NULL,
  \`token\`        VARCHAR(512) NOT NULL,
  \`platform\`     VARCHAR(16) NULL,
  \`created_at\`   DATETIME NULL,
  \`updated_at\`   DATETIME NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uniq_device_token\` (\`token\`),
  KEY \`idx_dt_customer\` (\`customer_id\`, \`updated_at\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

async function main() {
  await prisma.$executeRawUnsafe(DDL);
  await prisma.$executeRawUnsafe("DELETE FROM ws_customer_device_token");

  await mongoose.connect(process.env.MONGODB_URI as string, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db!;

  const custCache = new Map<string, number | null>();
  const cust = async (mongoId: any): Promise<number | null> => {
    const key = mongoId ? String(mongoId) : null;
    if (!key) return null;
    if (custCache.has(key)) return custCache.get(key)!;
    let sqlId: number | null = null;
    try {
      const mc = await db.collection("ws_customers").findOne(
        { _id: new mongoose.Types.ObjectId(key) },
        { projection: { phoneNumber: 1 } }
      );
      if (mc?.phoneNumber) {
        const rows = await prisma.$queryRawUnsafe<any[]>(
          "SELECT id FROM ws_customer WHERE phone=? LIMIT 1", String(mc.phoneNumber)
        );
        if (rows.length) sqlId = rows[0].id;
      }
    } catch { /* ignore */ }
    custCache.set(key, sqlId);
    return sqlId;
  };

  // token → best row (newest updatedAt wins, last writer semantics)
  const byToken = new Map<string, { customerId: number; platform: string | null; createdAt: Date | null; updatedAt: Date | null }>();
  let docsIn = 0, tokensIn = 0, custMiss = 0;

  const cursor = db.collection("ws_customers").find(
    { firebaseTokens: { $exists: true, $ne: [] } },
    { projection: { _id: 1, firebaseTokens: 1 } }
  );
  for await (const c of cursor) {
    docsIn++;
    const sqlId = await cust(c._id);
    if (!sqlId) { custMiss++; continue; }
    for (const t of (c.firebaseTokens || [])) {
      if (!t?.token) continue;
      tokensIn++;
      const updatedAt = d(t.updatedAt);
      const prev = byToken.get(t.token);
      // newest updatedAt wins; null updatedAt loses to a dated one
      if (prev && (prev.updatedAt?.getTime() ?? 0) >= (updatedAt?.getTime() ?? 0)) continue;
      byToken.set(t.token, {
        customerId: sqlId,
        platform: t.platform ?? null,
        createdAt: updatedAt,
        updatedAt,
      });
    }
  }

  let out = 0;
  for (const [token, r] of byToken) {
    await prisma.customerDeviceToken.create({
      data: {
        customerId: r.customerId,
        token,
        platform: r.platform,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      },
    });
    out++;
  }

  console.log(JSON.stringify({ docsIn, tokensIn, custMiss, distinctTokens: byToken.size, out }, null, 2));
  await mongoose.disconnect();
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
