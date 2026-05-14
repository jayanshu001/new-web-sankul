/**
 * Integration test for the live course flow — the parts that do NOT depend on
 * Razorpay or Streamos credentials.
 *
 *   admin creates course -> plan -> folder -> video
 *   admin free-grants a subscription to a customer
 *   entitlement + per-viewer 3-min preview state machine
 *   admin schedules a live session (no Streamos call)
 *   a recording "arrives" -> promote it into a folder (idempotent)
 *   client-facing recordings / session-recordings listings
 *   promo-code validation + discount math
 *
 * NOT covered (needs external services / running server):
 *   - Razorpay create-order / verify / webhook  (no RAZORPAY_* in .env)
 *   - Streamos create / start / end stream      (hits the real third-party)
 *   - HTTP routing / auth middleware / zod       (needs the server running)
 *
 * Self-cleaning: every document it creates is tracked and deleted in `finally`,
 * even on failure. It reads (never mutates) one existing Customer to act as the
 * test student.
 *
 * Usage (from repo root) — point MONGODB_URI at a TEST database:
 *   npx tsx scripts/test-live-course-flow.ts
 */
import "dotenv/config";
import mongoose, { Types } from "mongoose";
import connectDB from "../src/config/db";

import { LiveCourse } from "../src/models/course/LiveCourse.model";
import { LiveCoursePlan } from "../src/models/course/LiveCoursePlan.model";
import { LiveSession } from "../src/models/course/LiveSession.model";
import { VideoCategory } from "../src/models/course/VideoCategory.model";
import { Video } from "../src/models/course/Video.model";
import { LiveCourseSubscription } from "../src/models/customer/LiveCourseSubscription.model";
import { LiveSessionPreview } from "../src/models/customer/LiveSessionPreview.model";
import { PromoCode } from "../src/models/course/PromoCode.model";
import { Customer } from "../src/models/customer/Customer.model";

import {
  hasAccessToAnyLiveCourse,
  resolveLivePreviewState,
  buildPurchaseOptions,
  PREVIEW_SECONDS,
} from "../src/client/live-course/entitlement";
import {
  resolveRecording,
  promoteRecordingToFolder,
} from "../src/admin/live/recording.promote";
import { resolveLivePromo } from "../src/client/live-course/promo";

// ── tiny test harness ──────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(label + (detail ? ` — ${detail}` : ""));
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(name: string) {
  console.log(`\n── ${name} ──`);
}

const MARK = `[lc-test ${Date.now()}]`;

async function main() {
  await connectDB();
  console.log(`Connected. Test marker: ${MARK}\n`);

  // tracked for cleanup
  const created = {
    courses: [] as Types.ObjectId[],
    plans: [] as Types.ObjectId[],
    folders: [] as Types.ObjectId[],
    videos: [] as Types.ObjectId[],
    sessions: [] as Types.ObjectId[],
    subscriptions: [] as Types.ObjectId[],
    previews: [] as Types.ObjectId[],
    promos: [] as Types.ObjectId[],
  };

  try {
    // ── borrow a real customer (read-only) ───────────────────────────────
    const student = await Customer.findOne({ isAccountDeleted: { $ne: true } })
      .select("_id")
      .lean();
    if (!student) throw new Error("No Customer in the DB to use as a test student.");
    const studentId = String(student._id);
    const outsiderId = new Types.ObjectId().toString(); // a customer with no sub

    // ════════════════════════════════════════════════════════════════════
    section("1. Admin creates live course (+ root folder)");
    const course = await LiveCourse.create({
      name: `${MARK} Course`,
      description: "integration test course",
      image: "https://example.com/x.jpg",
      ordered: 99999,
      level: "intermediate",
      classType: "live_offline",
      status: true,
      isPaid: true,
    });
    created.courses.push(course._id as Types.ObjectId);

    const rootFolder = await VideoCategory.create({
      title: `${MARK} Root`,
      slug: `${MARK}-root`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      image: course.image,
      liveCourseId: course._id,
      order_by: 0,
    });
    created.folders.push(rootFolder._id as Types.ObjectId);
    course.videoCategoryId = rootFolder._id as Types.ObjectId;
    await course.save();
    check("live course created", !!course._id);
    check("root folder linked to course", String(course.videoCategoryId) === String(rootFolder._id));
    check("classType persisted", course.classType === "live_offline");

    // ════════════════════════════════════════════════════════════════════
    section("2. Admin creates a pricing plan");
    const plan = await LiveCoursePlan.create({
      liveCourseId: course._id,
      name: "3 months",
      duration: 3,
      price: 1000,
      originalPrice: 4000,
      isDefault: true,
      status: true,
    });
    created.plans.push(plan._id as Types.ObjectId);
    check("plan created (duration=3 months, price=1000)", plan.price === 1000 && plan.duration === 3);
    check("plan originalPrice (MRP) persisted", plan.originalPrice === 4000);

    // ════════════════════════════════════════════════════════════════════
    section("3. Admin creates a folder + a video in it");
    const folder = await VideoCategory.create({
      title: `${MARK} Week 1`,
      slug: `${MARK}-week-1`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      image: course.image,
      liveCourseId: course._id,
      order_by: 1,
    });
    created.folders.push(folder._id as Types.ObjectId);

    const manualVideo = await Video.create({
      videoCategoryId: folder._id,
      title: `${MARK} Manual lecture`,
      platform: "youtube",
      youtube_id: "dQw4w9WgXcQ",
      priceType: "paid",
      order: 0,
      status: true,
    });
    created.videos.push(manualVideo._id as Types.ObjectId);
    check("folder created under course", String(folder.liveCourseId) === String(course._id));
    check("manual video created in folder", String(manualVideo.videoCategoryId) === String(folder._id));

    // ════════════════════════════════════════════════════════════════════
    section("4. Entitlement — student has NO access before purchase");
    const beforeGrant = await hasAccessToAnyLiveCourse(studentId, [String(course._id)]);
    check("hasAccessToAnyLiveCourse = false before purchase", beforeGrant === false);

    // ════════════════════════════════════════════════════════════════════
    section("5. Admin free-grants a subscription (no Razorpay needed)");
    const now = new Date();
    const endAt = new Date(now);
    endAt.setMonth(endAt.getMonth() + plan.duration);
    const sub = await LiveCourseSubscription.create({
      customerId: studentId,
      liveCourseId: course._id,
      planId: plan._id,
      startAt: now,
      endAt,
      status: true,
      paidAmount: 0,
      paymentStatus: "verified",
      paidAt: now,
    });
    created.subscriptions.push(sub._id as Types.ObjectId);

    const afterGrant = await hasAccessToAnyLiveCourse(studentId, [String(course._id)]);
    check("hasAccessToAnyLiveCourse = true after grant", afterGrant === true);

    const outsiderAccess = await hasAccessToAnyLiveCourse(outsiderId, [String(course._id)]);
    check("a different customer still has no access", outsiderAccess === false);

    // expired subscription must NOT grant access
    const expiredEnd = new Date(now.getTime() - 24 * 3600 * 1000);
    const expiredSub = await LiveCourseSubscription.create({
      customerId: outsiderId,
      liveCourseId: course._id,
      planId: plan._id,
      startAt: new Date(now.getTime() - 90 * 24 * 3600 * 1000),
      endAt: expiredEnd,
      status: true,
      paymentStatus: "verified",
    });
    created.subscriptions.push(expiredSub._id as Types.ObjectId);
    const expiredAccess = await hasAccessToAnyLiveCourse(outsiderId, [String(course._id)]);
    check("expired subscription does NOT grant access", expiredAccess === false);

    // ════════════════════════════════════════════════════════════════════
    section("6. Admin schedules a live session (no Streamos call)");
    const scheduledAt = new Date(now.getTime() + 60 * 60 * 1000);
    const session = await LiveSession.create({
      title: `${MARK} Week 1 Live`,
      liveCourseIds: [course._id],
      subject: "Current Affairs",
      endAt: new Date(now.getTime() + 2 * 60 * 60 * 1000),
      scheduledAt,
      status: "SCHEDULED",
      recordings: [],
    });
    created.sessions.push(session._id as Types.ObjectId);
    check("session scheduled (status SCHEDULED, no streamId)", session.status === "SCHEDULED" && session.streamId == null);
    check("session timetable metadata persisted (subject + endAt)",
      session.subject === "Current Affairs" && !!session.endAt);

    // ════════════════════════════════════════════════════════════════════
    section("7. Per-viewer preview state machine");
    // subscriber -> always full, no preview row created
    const subView = await resolveLivePreviewState(studentId, session._id as Types.ObjectId, [String(course._id)], true);
    check("subscriber -> accessLevel 'full'", subView.accessLevel === "full");

    // non-subscriber, tracked -> preview, with a clock
    const pv1 = await resolveLivePreviewState(outsiderId, session._id as Types.ObjectId, [String(course._id)], true);
    check("non-subscriber first view -> 'preview'", pv1.accessLevel === "preview");
    check("preview has a positive previewSecondsRemaining", (pv1.previewSecondsRemaining ?? 0) > 0 && (pv1.previewSecondsRemaining ?? 0) <= PREVIEW_SECONDS);

    const previewRow = await LiveSessionPreview.findOne({ customerId: outsiderId, liveSessionId: session._id });
    if (previewRow) created.previews.push(previewRow._id as Types.ObjectId);
    check("a LiveSessionPreview row was created", !!previewRow);

    // re-request must NOT reset the clock
    const pv2 = await resolveLivePreviewState(outsiderId, session._id as Types.ObjectId, [String(course._id)], true);
    check("re-request keeps same window (clock not reset)", !!pv2.previewExpiresAt && !!pv1.previewExpiresAt &&
      pv2.previewExpiresAt.getTime() === pv1.previewExpiresAt.getTime());

    // force the window into the past -> preview_ended
    if (previewRow) {
      previewRow.startedAt = new Date(now.getTime() - (PREVIEW_SECONDS + 60) * 1000);
      await previewRow.save();
    }
    const pv3 = await resolveLivePreviewState(outsiderId, session._id as Types.ObjectId, [String(course._id)], true);
    check("after window elapses -> 'preview_ended'", pv3.accessLevel === "preview_ended");

    // a course-less session is open to anyone
    const openView = await resolveLivePreviewState(outsiderId, session._id as Types.ObjectId, [], true);
    check("session with no courses -> 'full' (open)", openView.accessLevel === "full");

    // ════════════════════════════════════════════════════════════════════
    section("8. purchaseOptions payload for the buy popup");
    const opts = await buildPurchaseOptions([String(course._id)]);
    check("buildPurchaseOptions returns the course", opts.length === 1 && opts[0].liveCourseId === String(course._id));
    check("purchase option includes the active plan", opts[0]?.plans.some((p) => p.planId === String(plan._id)));

    // ════════════════════════════════════════════════════════════════════
    section("9. Recording arrives -> promote into a folder");
    // simulate the Streamos webhook landing recordings on the session
    session.status = "READY";
    session.streamId = `T_test_${Date.now()}${Math.floor(Math.random() * 9999)}`;
    session.recordings = [
      { quality: "720p", file_size: 123456, path: `https://rec.example.com/${MARK}-720.mp4` },
      { quality: "480p", file_size: 65432, path: `https://rec.example.com/${MARK}-480.mp4` },
    ];
    await session.save();

    const picked = resolveRecording(session, { quality: "720p" });
    check("resolveRecording finds the 720p recording", picked?.quality === "720p");

    const promo1 = await promoteRecordingToFolder({
      session,
      recording: picked!,
      folderId: folder._id as Types.ObjectId,
    });
    if (promo1.video?._id) created.videos.push(promo1.video._id as Types.ObjectId);
    check("recording promoted -> Video created", !promo1.alreadyExisted && !!promo1.video?._id);
    check("promoted Video carries liveSessionId back-link",
      String(promo1.video.liveSessionId) === String(session._id));

    // idempotent: promoting the same recording into the same folder again
    const promo2 = await promoteRecordingToFolder({
      session,
      recording: picked!,
      folderId: folder._id as Types.ObjectId,
    });
    check("re-promote is idempotent (alreadyExisted=true, no duplicate)",
      promo2.alreadyExisted === true && String(promo2.video._id) === String(promo1.video._id));

    // ════════════════════════════════════════════════════════════════════
    section("10. Client-facing recordings listings (DB-level)");
    // folder videos for the course
    const folderIds = (await VideoCategory.find({ liveCourseId: course._id }).select("_id").lean())
      .map((f) => f._id);
    const folderVideos = await Video.find({ videoCategoryId: { $in: folderIds }, status: true }).lean();
    check("folder-videos listing finds manual + promoted video", folderVideos.length >= 2);

    // raw streamos recordings for the course (the /session-recordings query)
    const recSessions = await LiveSession.find({
      liveCourseIds: course._id,
      status: { $in: ["ENDED", "READY"] },
      "recordings.0": { $exists: true },
    }).lean();
    check("session-recordings query finds the READY session", recSessions.length === 1);
    check("session carries 2 recording qualities", (recSessions[0]?.recordings?.length ?? 0) === 2);

    // ════════════════════════════════════════════════════════════════════
    section("11. Promo code validation + discount math");
    const pctPromo = await PromoCode.create({
      type: "public",
      promocode: `${MARK}-PCT`.toUpperCase().replace(/[^A-Z0-9]/g, ""),
      title: "10% off",
      description: "",
      promo_start_at: new Date(now.getTime() - 3600 * 1000),
      promo_expire_at: new Date(now.getTime() + 7 * 24 * 3600 * 1000),
      status: true,
      discountType: "percentage",
      discountValue: 10,
    });
    created.promos.push(pctPromo._id as Types.ObjectId);

    const flatPromo = await PromoCode.create({
      type: "public",
      promocode: `${MARK}-FLAT`.toUpperCase().replace(/[^A-Z0-9]/g, ""),
      title: "200 off",
      description: "",
      promo_start_at: new Date(now.getTime() - 3600 * 1000),
      promo_expire_at: new Date(now.getTime() + 7 * 24 * 3600 * 1000),
      status: true,
      discountType: "flat",
      discountValue: 200,
    });
    created.promos.push(flatPromo._id as Types.ObjectId);

    const expiredPromo = await PromoCode.create({
      type: "public",
      promocode: `${MARK}-EXP`.toUpperCase().replace(/[^A-Z0-9]/g, ""),
      title: "expired",
      description: "",
      promo_start_at: new Date(now.getTime() - 14 * 24 * 3600 * 1000),
      promo_expire_at: new Date(now.getTime() - 24 * 3600 * 1000),
      status: true,
      discountType: "percentage",
      discountValue: 50,
    });
    created.promos.push(expiredPromo._id as Types.ObjectId);

    const pct = await resolveLivePromo(pctPromo.promocode, 1000);
    check("percentage promo: 10% off 1000 -> finalAmount 900",
      pct.result?.discountAmount === 100 && pct.result?.finalAmount === 900);

    const flat = await resolveLivePromo(flatPromo.promocode, 1000);
    check("flat promo: 200 off 1000 -> finalAmount 800",
      flat.result?.discountAmount === 200 && flat.result?.finalAmount === 800);

    const exp = await resolveLivePromo(expiredPromo.promocode, 1000);
    check("expired promo is rejected", !!exp.error && !exp.result);

    const bogus = await resolveLivePromo("NOPE-DOES-NOT-EXIST", 1000);
    check("unknown promo is rejected", !!bogus.error && !bogus.result);

    // case-insensitive + discount can't exceed the price
    const lower = await resolveLivePromo(flatPromo.promocode.toLowerCase(), 150);
    check("flat discount is clamped to the base amount (>=0 final)",
      lower.result?.finalAmount === 0 && lower.result?.discountAmount === 150);

    // ════════════════════════════════════════════════════════════════════
    section("12. Subscription window math (verify-style)");
    const computedEnd = new Date(now);
    computedEnd.setMonth(computedEnd.getMonth() + plan.duration);
    check("endAt = startAt + plan.duration months (calendar months)",
      Math.abs(sub.endAt!.getTime() - computedEnd.getTime()) < 1000);
  } finally {
    // ── cleanup — always runs ────────────────────────────────────────────
    section("Cleanup");
    const r = await Promise.allSettled([
      LiveSessionPreview.deleteMany({ _id: { $in: created.previews } }),
      LiveCourseSubscription.deleteMany({ _id: { $in: created.subscriptions } }),
      Video.deleteMany({ _id: { $in: created.videos } }),
      LiveSession.deleteMany({ _id: { $in: created.sessions } }),
      VideoCategory.deleteMany({ _id: { $in: created.folders } }),
      LiveCoursePlan.deleteMany({ _id: { $in: created.plans } }),
      LiveCourse.deleteMany({ _id: { $in: created.courses } }),
      PromoCode.deleteMany({ _id: { $in: created.promos } }),
    ]);
    const cleaned = r.filter((x) => x.status === "fulfilled").length;
    console.log(`  cleaned ${cleaned}/8 collections (test marker ${MARK})`);
    // safety net: sweep anything left carrying the marker
    await Promise.allSettled([
      LiveCourse.deleteMany({ name: { $regex: MARK.replace(/[[\]]/g, "\\$&") } }),
      VideoCategory.deleteMany({ title: { $regex: MARK.replace(/[[\]]/g, "\\$&") } }),
      Video.deleteMany({ title: { $regex: MARK.replace(/[[\]]/g, "\\$&") } }),
      LiveSession.deleteMany({ title: { $regex: MARK.replace(/[[\]]/g, "\\$&") } }),
      PromoCode.deleteMany({ promocode: { $regex: MARK.toUpperCase().replace(/[^A-Z0-9]/g, "") } }),
    ]);

    await mongoose.disconnect();
  }

  // ── report ─────────────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(48)}`);
  console.log(`  RESULT: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("  FAILURES:");
    for (const f of failures) console.log(`   - ${f}`);
  }
  console.log("=".repeat(48));
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error("\nTest run crashed:", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
