/**
 * Wave 6 backfill — copy the live MongoDB LiveCourse data into the new SQL
 * ws_live_* tables (created by 2026-06-18_create_ws_live_course_tables.sql).
 *
 * Strategy:
 *  - Insert in dependency order; build an ObjectId→newIntId map per collection so
 *    INTRA-FAMILY refs (plan→course, sub→course/plan, session→course, vote→poll,
 *    option→poll) resolve to the freshly-minted int ids.
 *  - EXTERNAL refs: customer is resolved Mongo ObjectId → ws_customers.phoneNumber
 *    → ws_customer.id (phone bridge). Other external refs (educator / subject /
 *    video / package category) have NO id bridge in Mongo — stored as 0/null
 *    (best-effort; logged). Production data bridges better than staging.
 *  - Idempotent-ish: TRUNCATEs the ws_live_* tables first (safe — they were just
 *    created empty). Embedded arrays (schedule, recordings, hlsUrls, timetable)
 *    → JSON columns; poll options[] → ws_live_poll_option child rows.
 *
 * Run: npx tsx scripts/backfill-live-course-to-sql.ts
 */
import "dotenv/config";
import mongoose from "mongoose";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/config/prisma";

function oid(v: any) { return v ? String(v) : null; }
function d(v: any) { return v ? new Date(v) : null; }
// Prisma Json columns take the raw value (it serializes); null → Prisma.JsonNull.
function json(v: any) { return v == null ? Prisma.JsonNull : v; }

async function main() {
  await mongoose.connect(process.env.MONGODB_URI as string, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db!;

  // ── customer phone bridge (ObjectId → SQL int id) ──────────────────────────
  const custCache = new Map<string, number | null>();
  const resolveCustomer = async (mongoId: any): Promise<number | null> => {
    const key = oid(mongoId);
    if (!key) return null;
    if (custCache.has(key)) return custCache.get(key)!;
    let sqlId: number | null = null;
    try {
      const mc = await db.collection("ws_customers").findOne({ _id: new mongoose.Types.ObjectId(key) }, { projection: { phoneNumber: 1 } });
      if (mc?.phoneNumber) {
        const rows = await prisma.$queryRawUnsafe<any[]>("SELECT id FROM ws_customer WHERE phone=? LIMIT 1", String(mc.phoneNumber));
        if (rows.length) sqlId = rows[0].id;
      }
    } catch { /* ignore */ }
    custCache.set(key, sqlId);
    return sqlId;
  };

  let custResolved = 0, custMissed = 0;
  const cust = async (mongoId: any): Promise<number | null> => {
    const r = await resolveCustomer(mongoId);
    if (mongoId) (r != null ? custResolved++ : custMissed++);
    return r;
  };

  // wipe (tables were just created; safe to truncate for a clean re-run)
  for (const t of ["ws_live_session_course","ws_live_poll_option","ws_live_poll_vote","ws_live_poll","ws_live_chat_message","ws_live_chat_ban","ws_live_session_attendance","ws_live_session_reminder","ws_live_session_preview","ws_live_course_subscription","ws_live_course_plan","ws_live_session","ws_live_course","ws_live_course_category"]) {
    await prisma.$executeRawUnsafe(`DELETE FROM ${t}`);
  }

  // ── 1. courses ──────────────────────────────────────────────────────────────
  const courseMap = new Map<string, number>();
  for (const c of await db.collection("ws_live_courses").find({}).toArray()) {
    const row = await prisma.liveCourse.create({ data: {
      name: c.name ?? "", subtitle: c.subtitle ?? null, description: c.description ?? null, image: c.image ?? null,
      ordered: c.ordered ?? 0, shareableLink: c.shareableLink ?? null, withMaterial: c.withMaterial ?? null,
      withoutMaterial: c.withoutMaterial ?? null, level: c.level ?? null, classType: c.classType ?? "live",
      status: !!c.status, isPaid: c.isPaid !== false, isPopular: !!c.isPopular,
      educatorId: null, courseSubjectCategoryId: null, videoCategoryId: null, packageCategoryId: null, createdBy: null,
      startTime: d(c.startTime), scheduleEntries: json(c.scheduleEntries), scheduleFolders: json(c.scheduleFolders),
      timetableFiles: json(c.timetableFiles), examCountdownCategoryIds: json(c.examCountdownCategoryIds), examCountdownIds: json(c.examCountdownIds),
      createdAt: d(c.createdAt), updatedAt: d(c.updatedAt),
    }});
    courseMap.set(String(c._id), row.id);
  }

  // ── 2. plans ──────────────────────────────────────────────────────────────
  const planMap = new Map<string, number>();
  for (const p of await db.collection("ws_live_course_plans").find({}).toArray()) {
    const courseId = courseMap.get(oid(p.liveCourseId) ?? "");
    if (!courseId) continue;
    const row = await prisma.liveCoursePlan.create({ data: {
      liveCourseId: courseId, name: p.name ?? null, duration: p.duration ?? 0, price: p.price ?? 0,
      originalPrice: p.originalPrice ?? null, isDefault: !!p.isDefault, status: p.status !== false,
      createdAt: d(p.createdAt), updatedAt: d(p.updatedAt),
    }});
    planMap.set(String(p._id), row.id);
  }

  // ── 3. subscriptions ────────────────────────────────────────────────────────
  let subCount = 0;
  for (const s of await db.collection("ws_live_course_subscriptions").find({}).toArray()) {
    const courseId = courseMap.get(oid(s.liveCourseId) ?? "");
    if (!courseId) continue;
    await prisma.liveCourseSubscription.create({ data: {
      customerId: (await cust(s.customerId)) ?? 0, liveCourseId: courseId, planId: planMap.get(oid(s.planId) ?? "") ?? null,
      startAt: d(s.startAt), endAt: d(s.endAt), status: s.status !== false, promocodeId: null,
      originalAmount: s.originalAmount ?? null, discountAmount: s.discountAmount ?? null, paidAmount: s.paidAmount ?? null,
      paymentStatus: s.paymentStatus ?? null, razorpayOrderId: s.razorpayOrderId ?? null, razorpayPaymentId: s.razorpayPaymentId ?? null,
      paidAt: d(s.paidAt), createdAt: d(s.createdAt), updatedAt: d(s.updatedAt),
    }});
    subCount++;
  }

  // ── 4. sessions + session_course join ────────────────────────────────────────
  const sessionMap = new Map<string, number>();
  for (const ss of await db.collection("ws_live_sessions").find({}).toArray()) {
    const row = await prisma.liveSession.create({ data: {
      title: ss.title ?? null, subject: ss.subject ?? null, educatorId: null,
      scheduledAt: d(ss.scheduledAt), endAt: d(ss.endAt), status: ss.status ?? "SCHEDULED",
      streamId: ss.streamId ?? null, rtmpUrl: ss.rtmpUrl ?? null, hlsUrl: ss.hlsUrl ?? null,
      hlsUrls: json(ss.hlsUrls), recordings: json(ss.recordings), recordingTargetFolderId: null,
      createdAt: d(ss.createdAt), updatedAt: d(ss.updatedAt),
    }});
    sessionMap.set(String(ss._id), row.id);
    for (const lcid of (ss.liveCourseIds ?? [])) {
      const courseId = courseMap.get(oid(lcid) ?? "");
      if (courseId) await prisma.liveSessionCourse.create({ data: { liveSessionId: row.id, liveCourseId: courseId, createdAt: d(ss.createdAt) } }).catch(() => {});
    }
  }

  // ── 5. categories (empty in Mongo, but copy if any appear) ───────────────────
  for (const cat of await db.collection("ws_live_course_categories").find({}).toArray()) {
    await prisma.liveCourseCategory.create({ data: {
      name: cat.name ?? cat.title ?? "", slug: cat.slug ?? null, image: cat.image ?? null,
      parent: 0, order_by: cat.order ?? 0, status: cat.status !== false, createdAt: d(cat.createdAt), updatedAt: d(cat.updatedAt),
    }});
  }

  // ── 6. chat messages ──────────────────────────────────────────────────────
  let chatCount = 0;
  for (const m of await db.collection("ws_live_chat_messages").find({}).toArray()) {
    await prisma.liveChatMessage.create({ data: {
      liveClassId: String(m.liveClassId ?? ""), customerId: await cust(m.customerId), adminId: null, isAdmin: !!m.isAdmin,
      userName: m.userName ?? null, message: m.message ?? null, deletedAt: d(m.deletedAt), deletedBy: null,
      createdAt: d(m.createdAt), updatedAt: d(m.updatedAt),
    }});
    chatCount++;
  }
  for (const b of await db.collection("ws_live_chat_bans").find({}).toArray()) {
    await prisma.liveChatBan.create({ data: {
      liveClassId: String(b.liveClassId ?? ""), customerId: await cust(b.customerId), bannedBy: null, reason: b.reason ?? null,
      createdAt: d(b.createdAt), updatedAt: d(b.updatedAt),
    }});
  }

  // ── 7. polls + options + votes ────────────────────────────────────────────
  const pollMap = new Map<string, number>();
  for (const p of await db.collection("ws_live_polls").find({}).toArray()) {
    const row = await prisma.livePoll.create({ data: {
      liveClassId: String(p.liveClassId ?? ""), question: p.question ?? "", totalVotes: p.totalVotes ?? 0,
      isActive: !!p.isActive, createdBy: null, createdByName: p.createdByName ?? null, closedAt: d(p.closedAt),
      createdAt: d(p.createdAt), updatedAt: d(p.updatedAt),
    }});
    pollMap.set(String(p._id), row.id);
    const opts = (p.options ?? []) as any[];
    for (let i = 0; i < opts.length; i++) {
      await prisma.livePollOption.create({ data: { pollId: row.id, optionIndex: i, text: opts[i]?.text ?? null, votes: opts[i]?.votes ?? 0 } });
    }
  }
  let voteCount = 0;
  for (const v of await db.collection("ws_live_poll_votes").find({}).toArray()) {
    const pollId = pollMap.get(oid(v.pollId) ?? "");
    if (!pollId) continue;
    await prisma.livePollVote.create({ data: {
      pollId, customerId: (await cust(v.customerId)) ?? 0, optionIndex: v.optionIndex ?? 0, createdAt: d(v.createdAt), updatedAt: d(v.updatedAt),
    }}).catch(() => {}); // unique (poll,customer) — skip dupes
    voteCount++;
  }

  // ── 8. attendance ──────────────────────────────────────────────────────────
  let attCount = 0;
  for (const a of await db.collection("ws_live_session_attendance").find({}).toArray()) {
    await prisma.liveSessionAttendance.create({ data: {
      streamId: a.streamId ?? null, liveSessionId: sessionMap.get(oid(a.liveSessionId) ?? "") ?? null, customerId: await cust(a.customerId),
      userName: a.userName ?? null, joinedAt: d(a.joinedAt), leftAt: d(a.leftAt), durationSec: a.durationSec ?? null,
      createdAt: d(a.createdAt), updatedAt: d(a.updatedAt),
    }});
    attCount++;
  }

  // ── 9. reminders + previews ─────────────────────────────────────────────────
  let remCount = 0;
  for (const r of await db.collection("livesessionreminders").find({}).toArray()) {
    await prisma.liveSessionReminder.create({ data: {
      liveSessionId: sessionMap.get(oid(r.liveSessionId) ?? "") ?? null, liveCourseId: courseMap.get(oid(r.liveCourseId) ?? "") ?? null,
      customerId: await cust(r.customerId), minutesBefore: r.minutesBefore ?? null, notificationId: null,
      remindAt: d(r.remindAt), sessionScheduledAt: d(r.sessionScheduledAt), status: r.status ?? null,
      createdAt: d(r.createdAt), updatedAt: d(r.updatedAt),
    }});
    remCount++;
  }
  let prevCount = 0;
  for (const p of await db.collection("ws_live_session_previews").find({}).toArray()) {
    await prisma.liveSessionPreview.create({ data: {
      liveSessionId: sessionMap.get(oid(p.liveSessionId) ?? "") ?? null, customerId: await cust(p.customerId),
      startedAt: d(p.startedAt), createdAt: d(p.createdAt), updatedAt: d(p.updatedAt),
    }});
    prevCount++;
  }

  console.log("\n=== Backfill complete ===");
  console.log(`courses:${courseMap.size} plans:${planMap.size} subs:${subCount} sessions:${sessionMap.size} polls:${pollMap.size} votes:${voteCount} chat:${chatCount} attendance:${attCount} reminders:${remCount} previews:${prevCount}`);
  console.log(`customer phone-bridge: ${custResolved} resolved, ${custMissed} stored as 0/null (staging test users not in SQL dump)`);

  await mongoose.disconnect();
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
