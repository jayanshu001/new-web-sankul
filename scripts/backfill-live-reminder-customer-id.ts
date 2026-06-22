/*
 * Repair pass: fill `ws_live_session_reminder.customer_id` where it is NULL.
 *
 * The original `backfill-live-course-to-sql.ts` inserts reminders with
 * `customerId: await cust(r.customerId)` (Mongo ObjectId → ws_customer via the
 * phone bridge). Rows whose Mongo customer is absent from `ws_customer` land with
 * customer_id = NULL, which makes per-customer reminder reads
 * (`GET /client/live-reminders`) return empty for those users.
 *
 * This script re-resolves each Mongo reminder's customer and UPDATEs the matching
 * SQL row (correlated by live_session_id + remind_at) when, and only when, the
 * customer is now resolvable. Idempotent: only touches rows with customer_id IS
 * NULL; resolves nothing if the source customer still isn't in ws_customer (the
 * data is genuinely disjoint, e.g. in a subset staging DB — those rows stay NULL,
 * never fabricated).
 *
 * Run: DATABASE_URL='...' MONGODB_URI='...' npx tsx scripts/backfill-live-reminder-customer-id.ts
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import { prisma } from "../src/config/prisma";

dotenv.config();

const oid = (v: any): string | null => (v ? String(v) : null);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI as string, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db!;

  // ── customer phone bridge (Mongo ObjectId → ws_customer.id) ──────────────────
  const custCache = new Map<string, number | null>();
  const resolveCustomer = async (mongoId: any): Promise<number | null> => {
    const key = oid(mongoId);
    if (!key) return null;
    if (custCache.has(key)) return custCache.get(key)!;
    let id: number | null = null;
    const mc = await db
      .collection("ws_customers")
      .findOne({ _id: new mongoose.Types.ObjectId(key) }, { projection: { phoneNumber: 1 } });
    if (mc?.phoneNumber) {
      const rows = await prisma.$queryRawUnsafe<any[]>(
        "SELECT id FROM ws_customer WHERE phone=? LIMIT 1",
        String(mc.phoneNumber)
      );
      if (rows.length) id = rows[0].id;
    }
    custCache.set(key, id);
    return id;
  };

  // ── Mongo liveSession ObjectId → SQL ws_live_session.id (title + scheduledAt) ─
  const sqlSessions = await prisma.liveSession.findMany({
    select: { id: true, title: true, scheduledAt: true },
  });
  const sessKey = (title: string | null, when: Date | null) =>
    `${(title ?? "").trim()}|${when ? new Date(when).getTime() : ""}`;
  const sqlSessionByKey = new Map(sqlSessions.map((s) => [sessKey(s.title, s.scheduledAt), s.id]));

  const sessionMongoToSql = new Map<string, number>();
  for (const ms of await db.collection("ws_live_sessions").find({}).toArray()) {
    const sqlId = sqlSessionByKey.get(sessKey(ms.title ?? null, ms.scheduledAt ?? null));
    if (sqlId != null) sessionMongoToSql.set(String(ms._id), sqlId);
  }

  // ── repair ─────────────────────────────────────────────────────────────────
  const rems = await db.collection("livesessionreminders").find({}).toArray();
  let updated = 0,
    custUnresolved = 0,
    sessUnresolved = 0,
    noSqlRow = 0,
    alreadySet = 0;

  for (const r of rems) {
    const sqlCustomer = await resolveCustomer(r.customerId);
    if (sqlCustomer == null) {
      custUnresolved++;
      continue;
    }
    const sqlSessionId = r.liveSessionId ? sessionMongoToSql.get(String(r.liveSessionId)) : undefined;
    if (sqlSessionId == null) {
      sessUnresolved++;
      continue;
    }
    const remindAt = r.remindAt ? new Date(r.remindAt) : null;

    const result = await prisma.liveSessionReminder.updateMany({
      where: {
        liveSessionId: sqlSessionId,
        customerId: null,
        ...(remindAt ? { remindAt } : {}),
      },
      data: { customerId: sqlCustomer },
    });
    if (result.count > 0) updated += result.count;
    else {
      // either no NULL row matched (already set on a prior run) or no SQL row exists
      const exists = await prisma.liveSessionReminder.count({
        where: { liveSessionId: sqlSessionId, ...(remindAt ? { remindAt } : {}) },
      });
      if (exists) alreadySet++;
      else noSqlRow++;
    }
  }

  const stillNull = await prisma.liveSessionReminder.count({ where: { customerId: null } });
  console.log(
    `live-reminder customer_id: updated=${updated} alreadySet=${alreadySet} ` +
      `customerUnresolved=${custUnresolved} sessionUnresolved=${sessUnresolved} noSqlRow=${noSqlRow} ` +
      `(mongo total ${rems.length}); ws_live_session_reminder still NULL = ${stillNull}`
  );

  await mongoose.disconnect();
  await prisma.$disconnect();
  process.exit(0);
})();
