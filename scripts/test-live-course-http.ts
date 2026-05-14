/**
 * HTTP smoke test for the live course flow — drives the REAL Express routes
 * (routing + auth middleware + zod validation + controllers) against a running
 * server on PORT.
 *
 * Auth:
 *   - Customer: real OTP flow using a TESTING_PHONE_NUMBERS entry (static OTP).
 *   - Admin: a JWT minted with JWT_ACCESS_SECRET + a matching `admin_session`
 *     key seeded in Redis (the `authenticate` middleware checks Redis for admin
 *     tokens). This is a test-only shortcut — no admin credentials needed.
 *
 * Covers: admin course/plan/folder/video CRUD + reorder, free-grant + 409,
 * subscription list/get/update, session scheduling, recording promotion;
 * customer browse, my-courses, apply-promo, REAL Razorpay test create-order,
 * verify with a locally-computed signature, recordings/lecture/session reads.
 *
 * NOT covered: Streamos stream start/end (real third-party) — sessions are
 * scheduled (no Streamos call) and recordings are injected at the DB layer.
 *
 * Self-cleaning: every created doc is tracked and removed in `finally`.
 *
 * Prereq: the server must be running. Usage:
 *   npx tsx src/index.ts &           # in another shell
 *   npx tsx scripts/test-live-course-http.ts
 */
import "dotenv/config";
import mongoose, { Types } from "mongoose";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import axios, { AxiosInstance } from "axios";
import Redis from "ioredis";
import { io as ioClient } from "socket.io-client";
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
import { CourseEducator } from "../src/models/course/CourseEducator.model";
import { LiveSessionAttendance } from "../src/models/customer/LiveSessionAttendance.model";

const PORT = process.env.PORT || 4000;
const BASE = `http://localhost:${PORT}/api/v1`;
const JWT_SECRET = process.env.JWT_ACCESS_SECRET as string;
const RZP_SECRET = process.env.RAZORPAY_KEY_SECRET as string;
const TEST_PHONE = (process.env.TESTING_PHONE_NUMBERS || "").split(",")[0]?.trim() || "9999999999";
const TEST_PHONE_B = (process.env.TESTING_PHONE_NUMBERS || "").split(",")[1]?.trim() || "8888888888";
const STATIC_OTP = "5786";
const MARK = `[lc-http ${Date.now()}]`;

// ── harness ────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(label + (detail ? ` — ${detail}` : "")); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}
function section(n: string) { console.log(`\n── ${n} ──`); }

// axios that never throws on 4xx/5xx — we assert on status ourselves
function client(token?: string): AxiosInstance {
  return axios.create({
    baseURL: BASE,
    timeout: 20000,
    validateStatus: () => true,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

// Mint a customer token the same way the OTP flow does (the OTP HTTP flow is
// IP rate-limited, and OTP login isn't part of the live-course module under
// test). Mirrors auth.service: JWT { id, phone, role, type } + a matching
// `customer_session` key in Redis, which `authenticate` checks.
async function mintCustomerToken(
  redis: Redis,
  customerId: string,
  phone: string
): Promise<string> {
  const token = jwt.sign(
    { id: customerId, phone, role: "customer", type: "customer" },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
  await redis.set(`customer_session:${customerId}`, token, "EX", 3600);
  return token;
}

async function main() {
  await connectDB();
  const redis = new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: Number(process.env.REDIS_PORT) || 6380,
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: 2,
  });

  const pub = client(); // unauthenticated
  // wait for server — any HTTP status from a known route means it's up
  let up = false;
  for (let i = 0; i < 30; i++) {
    try { const r = await pub.get("/admin/live-courses"); if (r.status) { up = true; break; } } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!up) throw new Error(`server not reachable at ${BASE}`);
  console.log(`Server up at ${BASE}. Marker: ${MARK}`);

  // ── admin token: mint + seed Redis ───────────────────────────────────────
  const adminId = new Types.ObjectId().toString();
  const adminToken = jwt.sign(
    { id: adminId, email: "lc-http-test@local", role: "super_admin", type: "admin" },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
  await redis.set(`admin_session:${adminId}`, adminToken, "EX", 3600);
  const admin = client(adminToken);

  const created = {
    courses: [] as string[], plans: [] as string[], folders: [] as string[],
    videos: [] as string[], sessions: [] as string[], subs: [] as string[],
    promos: [] as string[],
  };
  // hoisted so `finally` can clean up the seeded Redis sessions
  let customerAId = "";
  let customerBId = "";

  try {
    // ════════════════════════════════════════════════════════════════════
    section("0. Auth");
    const auth0 = await client().get("/admin/live-courses");
    check("unauthenticated admin route -> 401", auth0.status === 401, `got ${auth0.status}`);

    // Resolve two real customers from the DB. A = the first testing phone
    // (always present). B = the second testing phone if it exists, else any
    // other customer — used only as a free-grant target.
    const phoneA10 = TEST_PHONE.replace(/\D/g, "").slice(-10);
    const phoneB10 = TEST_PHONE_B.replace(/\D/g, "").slice(-10);
    const cA = await Customer.findOne({ phoneNumber: phoneA10, isAccountDeleted: { $ne: true } })
      .select("_id phoneNumber").lean();
    if (!cA) throw new Error(`testing customer ${phoneA10} not found in DB`);
    let cB = await Customer.findOne({ phoneNumber: phoneB10, isAccountDeleted: { $ne: true } })
      .select("_id phoneNumber").lean();
    if (!cB) {
      cB = await Customer.findOne({ _id: { $ne: cA._id }, isAccountDeleted: { $ne: true } })
        .select("_id phoneNumber").lean();
    }
    if (!cB) throw new Error("need a second customer in the DB for the grant test");
    customerAId = String(cA._id);
    customerBId = String(cB._id);

    const custToken = await mintCustomerToken(redis, customerAId, cA.phoneNumber || phoneA10);
    const custTokenB = await mintCustomerToken(redis, customerBId, cB.phoneNumber || phoneB10);
    const cust = client(custToken);
    const custB = client(custTokenB);
    check("customer token minted + session seeded (A)", !!custToken);
    check("customer token minted + session seeded (B)", !!custTokenB && customerBId !== customerAId);

    // optional: a real CourseEducator for the timetable metadata (read-only)
    const educatorDoc = await CourseEducator.findOne().select("_id").lean();
    const educatorId = educatorDoc ? String(educatorDoc._id) : null;

    const meCheck = await cust.get("/client/live-courses");
    check("minted customer token authenticates on a client route -> 200", meCheck.status === 200, `got ${meCheck.status}`);
    const wrongRole = await cust.get("/admin/live-courses");
    check("customer hitting admin route -> 403", wrongRole.status === 403, `got ${wrongRole.status}`);

    // ════════════════════════════════════════════════════════════════════
    section("1. Admin creates live course");
    const cc = await admin.post("/admin/live-courses", {
      name: `${MARK} Course`,
      description: "http smoke test",
      image: "https://example.com/x.jpg",
      ordered: 99999,
      level: "intermediate",
      classType: "live_offline",
      status: true,
      isPaid: true,
    });
    check("POST /admin/live-courses -> 201", cc.status === 201, `${cc.status} ${JSON.stringify(cc.data?.message || cc.data)}`);
    const courseId = cc.data?.data?.liveCourse?._id;
    const rootFolderId = cc.data?.data?.rootFolder?._id;
    if (courseId) created.courses.push(courseId);
    if (rootFolderId) created.folders.push(rootFolderId);
    check("response carries liveCourse + auto-created rootFolder", !!courseId && !!rootFolderId);
    check("classType persisted", cc.data?.data?.liveCourse?.classType === "live_offline");

    // Timetable files (the "Time Table" file list on the Schedule tab)
    const ttf = await admin.patch(`/admin/live-courses/${courseId}/timetable-files`, {
      files: [{ title: `${MARK} Batch Time Table`, fileUrl: "https://cdn.example.com/tt.pdf", order: 0 }],
    });
    check("PATCH timetable-files -> 200, file stored",
      ttf.status === 200 && (ttf.data?.data?.timetableFiles?.length ?? 0) === 1,
      `${ttf.status} ${JSON.stringify(ttf.data?.data)}`);

    const dup = await admin.post("/admin/live-courses", {
      name: `${MARK} Course`, description: "d", image: "https://example.com/x.jpg",
      ordered: 1, level: "x", status: true,
    });
    check("duplicate course name -> 409", dup.status === 409, `got ${dup.status}`);

    // ════════════════════════════════════════════════════════════════════
    section("2. Admin creates plan");
    const cp = await admin.post(`/admin/live-courses/${courseId}/plans`, {
      name: "3 months", duration: 3, price: 1000, originalPrice: 4000, isDefault: true, status: true,
    });
    check("POST plans -> 201", cp.status === 201, `${cp.status} ${JSON.stringify(cp.data?.message || cp.data)}`);
    const planId = cp.data?.data?.plan?._id;
    if (planId) created.plans.push(planId);
    check("plan stored originalPrice (MRP)", cp.data?.data?.plan?.originalPrice === 4000);
    const pl = await admin.get(`/admin/live-courses/${courseId}/plans`);
    check("GET plans -> lists the plan", pl.status === 200 && (pl.data?.data?.plans?.length ?? 0) >= 1);

    // ════════════════════════════════════════════════════════════════════
    section("3. Admin creates folder + video, updates, reorders");
    const cf = await admin.post(`/admin/live-courses/${courseId}/folders`, { title: `${MARK} Week 1` });
    check("POST folder -> 201", cf.status === 201, `${cf.status} ${JSON.stringify(cf.data?.message || cf.data)}`);
    const folderId = cf.data?.data?.folder?._id;
    if (folderId) created.folders.push(folderId);

    const cv = await admin.post(`/admin/live-courses/${courseId}/folders/${folderId}/videos`, {
      title: `${MARK} Lecture 1`, platform: "youtube", youtube_id: "dQw4w9WgXcQ", priceType: "paid", order: 0,
    });
    check("POST video -> 201", cv.status === 201, `${cv.status} ${JSON.stringify(cv.data?.message || cv.data)}`);
    const videoId = cv.data?.data?.video?._id;
    if (videoId) created.videos.push(videoId);

    const uv = await admin.put(`/admin/live-courses/${courseId}/folders/${folderId}/videos/${videoId}`, {
      title: `${MARK} Lecture 1 (edited)`, order: 2,
    });
    check("PUT video -> 200 and title updated", uv.status === 200 && uv.data?.data?.video?.title?.includes("edited"));

    const rv = await admin.post(`/admin/live-courses/${courseId}/folders/${folderId}/videos/reorder`, {
      orders: [{ id: videoId, order: 0 }],
    });
    check("POST videos/reorder -> 200 (matched=1)", rv.status === 200 && rv.data?.data?.matched === 1, `${rv.status} ${JSON.stringify(rv.data?.data)}`);

    const gv = await admin.get(`/admin/live-courses/${courseId}/folders/${folderId}/videos/${videoId}`);
    check("GET single video -> 200", gv.status === 200 && gv.data?.data?.video?._id === videoId);

    // ════════════════════════════════════════════════════════════════════
    section("4. Admin free-grant + subscription management");
    const grant = await admin.post(`/admin/live-courses/${courseId}/grant`, {
      customerId: customerBId, planId,
    });
    check("POST grant -> 201", grant.status === 201, `${grant.status} ${JSON.stringify(grant.data?.message || grant.data)}`);
    const subBId = grant.data?.data?.subscription?._id;
    if (subBId) created.subs.push(subBId);

    const grantAgain = await admin.post(`/admin/live-courses/${courseId}/grant`, { customerId: customerBId, planId });
    check("re-grant active customer -> 409", grantAgain.status === 409, `got ${grantAgain.status}`);

    const listSubs = await admin.get(`/admin/live-courses/${courseId}/subscriptions`);
    check("GET /:id/subscriptions -> lists the grant", listSubs.status === 200 && (listSubs.data?.data?.subscriptions?.length ?? 0) >= 1);

    const getSub = await admin.get(`/admin/live-courses/subscriptions/${subBId}`);
    check("GET subscription detail -> 200", getSub.status === 200 && getSub.data?.data?.subscription?._id === subBId);

    const newEnd = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    const updSub = await admin.put(`/admin/live-courses/subscriptions/${subBId}`, { endAt: newEnd });
    check("PUT subscription (extend endAt) -> 200", updSub.status === 200);

    // ════════════════════════════════════════════════════════════════════
    section("5. Admin schedules a live session (no Streamos)");
    const scheduledAt = new Date(Date.now() + 3600 * 1000).toISOString();
    const endAt = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    const cs = await admin.post(`/admin/live-sessions`, {
      title: `${MARK} Week 1 Live`,
      liveCourseIds: [courseId],
      scheduledAt,
      endAt,
      subject: "Current Affairs",
      ...(educatorId ? { educatorId } : {}),
    });
    check("POST live-session (scheduled) -> 201", cs.status === 201, `${cs.status} ${JSON.stringify(cs.data?.message || cs.data)}`);
    const sessionId = cs.data?.data?.session?.id || cs.data?.data?.session?._id;
    if (sessionId) created.sessions.push(sessionId);
    check("session is SCHEDULED with no streamId", cs.data?.data?.session?.status === "SCHEDULED" && cs.data?.data?.session?.streamId == null);
    check("timetable metadata persisted (subject + endAt)",
      cs.data?.data?.session?.subject === "Current Affairs" && !!cs.data?.data?.session?.endAt);

    const getSess = await admin.get(`/admin/live-sessions/${sessionId}`);
    check("GET live-session -> 200", getSess.status === 200);

    const courseSessions = await admin.get(`/admin/live-courses/${courseId}/sessions`);
    check("GET /admin/live-courses/:id/sessions -> lists it", courseSessions.status === 200 && (courseSessions.data?.data?.sessions?.length ?? 0) >= 1);

    // ════════════════════════════════════════════════════════════════════
    section("6. Recording arrives (DB inject) -> promote via HTTP");
    const testStreamId = `T_test_${Date.now()}${Math.floor(Math.random() * 9999)}`;
    await LiveSession.findByIdAndUpdate(sessionId, {
      status: "READY",
      streamId: testStreamId,
      recordings: [
        { quality: "720p", file_size: 123456, path: `https://rec.example.com/${MARK}-720.mp4` },
        { quality: "480p", file_size: 65432, path: `https://rec.example.com/${MARK}-480.mp4` },
      ],
    });
    const promote = await admin.post(`/admin/live-sessions/${sessionId}/promote-recording`, {
      folderId, quality: "720p",
    });
    check("POST promote-recording -> 201", promote.status === 201, `${promote.status} ${JSON.stringify(promote.data?.message || promote.data)}`);
    const promotedVideoId = promote.data?.data?.video?._id;
    if (promotedVideoId) created.videos.push(promotedVideoId);
    check("promoted Video has liveSessionId back-link", String(promote.data?.data?.video?.liveSessionId) === String(sessionId));

    const promoteAgain = await admin.post(`/admin/live-sessions/${sessionId}/promote-recording`, { folderId, quality: "720p" });
    check("re-promote -> 200 alreadyExisted=true", promoteAgain.status === 200 && promoteAgain.data?.data?.alreadyExisted === true);

    // ════════════════════════════════════════════════════════════════════
    section("7. Customer browse (before purchase)");
    const cList = await cust.get(`/client/live-courses`);
    check("GET /client/live-courses -> 200", cList.status === 200);
    const cGet = await cust.get(`/client/live-courses/${courseId}`);
    check("GET /client/live-courses/:id -> subscribed:false", cGet.status === 200 && cGet.data?.data?.subscribed === false);
    check("detail bundle has stats (classType + counts)",
      cGet.data?.data?.stats?.classType === "live_offline" &&
      typeof cGet.data?.data?.stats?.subjectsCount === "number" &&
      typeof cGet.data?.data?.stats?.materialsCount === "number");
    check("plan carries computed discountPercent (1000 vs 4000 -> 75%)",
      cGet.data?.data?.plans?.[0]?.discountPercent === 75 && cGet.data?.data?.plans?.[0]?.originalPrice === 4000,
      JSON.stringify(cGet.data?.data?.plans?.[0]));

    const lectureLocked = await cust.get(`/client/live-courses/${courseId}/lecture/${videoId}`);
    check("GET lecture before purchase -> 403 with purchaseOptions", lectureLocked.status === 403 && Array.isArray(lectureLocked.data?.data?.purchaseOptions));

    // ════════════════════════════════════════════════════════════════════
    section("8. Promo code: preview + purchase + verify");
    const promo = await PromoCode.create({
      type: "public",
      promocode: `${MARK}PCT`.toUpperCase().replace(/[^A-Z0-9]/g, ""),
      title: "10% off", description: "",
      promo_start_at: new Date(Date.now() - 3600 * 1000),
      promo_expire_at: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      status: true, discountType: "percentage", discountValue: 10,
    });
    created.promos.push(String(promo._id));

    const preview = await cust.post(`/client/payment/apply-promo/live-course`, {
      planId, promocode: promo.promocode,
    });
    check("POST apply-promo -> 200, finalAmount 900", preview.status === 200 && preview.data?.data?.finalAmount === 900,
      `${preview.status} ${JSON.stringify(preview.data?.data)}`);

    const order = await cust.post(`/client/payment/create-order/live-course`, {
      planId, promocode: promo.promocode,
    });
    check("POST create-order (with promo) -> 201 (real Razorpay test order)", order.status === 201,
      `${order.status} ${JSON.stringify(order.data?.message || order.data)}`);
    const rzpOrderId = order.data?.data?.razorpay?.orderId;
    const subAId = order.data?.data?.subscriptionId;
    if (subAId) created.subs.push(subAId);
    check("order amount reflects the discount (₹900)", order.data?.data?.amountInRupees === 900);
    check("razorpay order id returned", !!rzpOrderId);

    // simulate Razorpay checkout success: compute the signature our verify expects
    const fakePaymentId = `pay_lchttp${Date.now()}`;
    const signature = crypto.createHmac("sha256", RZP_SECRET)
      .update(`${rzpOrderId}|${fakePaymentId}`).digest("hex");
    const verify = await cust.post(`/client/payment/verify`, {
      razorpay_order_id: rzpOrderId,
      razorpay_payment_id: fakePaymentId,
      razorpay_signature: signature,
    });
    check("POST verify (computed signature) -> 200, kind live-course",
      verify.status === 200 && verify.data?.data?.kind === "live-course",
      `${verify.status} ${JSON.stringify(verify.data)}`);
    check("subscription flipped to verified", verify.data?.data?.subscription?.paymentStatus === "verified");

    const badVerify = await cust.post(`/client/payment/verify`, {
      razorpay_order_id: rzpOrderId, razorpay_payment_id: fakePaymentId, razorpay_signature: "deadbeef",
    });
    check("verify with bad signature -> 400", badVerify.status === 400, `got ${badVerify.status}`);

    // ════════════════════════════════════════════════════════════════════
    section("9. Customer after purchase — full access");
    const cGet2 = await cust.get(`/client/live-courses/${courseId}`);
    check("GET course -> subscribed:true now", cGet2.status === 200 && cGet2.data?.data?.subscribed === true);

    const myCourses = await cust.get(`/client/live-courses/my`);
    check("GET /client/live-courses/my -> includes the course (active)",
      myCourses.status === 200 && (myCourses.data?.data?.liveCourses || []).some((x: any) => String(x.liveCourse?._id) === String(courseId) && x.active === true));

    const lectureOk = await cust.get(`/client/live-courses/${courseId}/lecture/${videoId}`);
    check("GET lecture after purchase -> 200 with videoUrl", lectureOk.status === 200 && !!lectureOk.data?.data?.videoUrl);

    const sess = await cust.get(`/client/live-sessions/${sessionId}`);
    check("GET /client/live-sessions/:id -> accessLevel 'full'", sess.status === 200 && sess.data?.data?.accessLevel === "full",
      `${sess.status} ${JSON.stringify(sess.data?.data?.accessLevel)}`);

    // ════════════════════════════════════════════════════════════════════
    section("10. Customer recordings listings");
    const sessRecs = await cust.get(`/client/live-courses/${courseId}/session-recordings`);
    check("GET /:id/session-recordings -> finds the READY session, not locked",
      sessRecs.status === 200 && (sessRecs.data?.data?.lectures?.length ?? 0) === 1 && sessRecs.data?.data?.lectures?.[0]?.locked === false,
      `${sessRecs.status} ${JSON.stringify(sessRecs.data?.data?.lectures)}`);
    check("session-recording exposes qualities, not mp4 urls",
      JSON.stringify(sessRecs.data?.data?.lectures?.[0]?.qualities || []).includes("720p") &&
      !JSON.stringify(sessRecs.data?.data || {}).includes("rec.example.com"));

    const folderRecs = await cust.get(`/client/live-courses/${courseId}/recordings`);
    check("GET /:id/recordings -> folders with the promoted + manual videos",
      folderRecs.status === 200 && (folderRecs.data?.data?.totalLectures ?? 0) >= 2,
      `${folderRecs.status} total=${folderRecs.data?.data?.totalLectures}`);

    const custSessions = await cust.get(`/client/live-courses/${courseId}/sessions`);
    check("GET /client/live-courses/:id/sessions -> 200, no hlsUrl leaked",
      custSessions.status === 200 && !JSON.stringify(custSessions.data?.data || {}).includes("hlsUrl"));

    // ════════════════════════════════════════════════════════════════════
    section("11. Customer B (granted) — entitlement via grant path");
    const myB = await custB.get(`/client/live-courses/my`);
    check("granted customer B sees the course in /my",
      myB.status === 200 && (myB.data?.data?.liveCourses || []).some((x: any) => String(x.liveCourse?._id) === String(courseId)));
    const lectureB = await custB.get(`/client/live-courses/${courseId}/lecture/${videoId}`);
    check("granted customer B can play the lecture -> 200", lectureB.status === 200 && !!lectureB.data?.data?.videoUrl);

    // ════════════════════════════════════════════════════════════════════
    section("12. Customer Schedule tab");
    const schedule = await cust.get(`/client/live-courses/${courseId}/schedule`);
    check("GET /:id/schedule -> 200", schedule.status === 200, `${schedule.status}`);
    check("timetable derived from the scheduled session (subject + sessionId)",
      (schedule.data?.data?.timetable || []).some(
        (t: any) => t.subject === "Current Affairs" && String(t.sessionId) === String(sessionId)
      ),
      JSON.stringify(schedule.data?.data?.timetable));
    check("schedule includes the timetable files",
      (schedule.data?.data?.files?.length ?? 0) === 1 &&
      String(schedule.data?.data?.files?.[0]?.title || "").includes(MARK));

    // ════════════════════════════════════════════════════════════════════
    section("13. Socket presence + attendance tracking");
    // resolveLiveClassId requires status CREATED, so flip the test session.
    await LiveSession.findByIdAndUpdate(sessionId, { status: "CREATED" });

    const sock = ioClient(BASE.replace("/api/v1", ""), {
      auth: { token: custToken },
      path: "/socket.io",
      transports: ["websocket"],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        sock.on("connect", () => resolve());
        sock.on("connect_error", (e) => reject(e));
        setTimeout(() => reject(new Error("socket connect timeout")), 8000);
      });
      check("socket.io client connects with the customer token", sock.connected);

      // join → expect a viewer_count broadcast (attendance is opened before it)
      const vc: any = await new Promise((resolve, reject) => {
        sock.once("viewer_count", resolve);
        sock.emit("join_live_chat", { liveClassId: testStreamId });
        setTimeout(() => reject(new Error("no viewer_count event")), 8000);
      }).catch((e) => ({ __err: e.message }));
      check("join_live_chat → viewer_count event", vc?.count >= 1, JSON.stringify(vc));

      const openRow = await LiveSessionAttendance.findOne({
        streamId: testStreamId,
        customerId: customerAId,
        leftAt: null,
      }).lean();
      check("attendance row opened on join (leftAt null)", !!openRow);

      // disconnect → server closes the attendance row
      sock.disconnect();
      await new Promise((r) => setTimeout(r, 1500));
      const closedRow = await LiveSessionAttendance.findOne({
        streamId: testStreamId,
        customerId: customerAId,
      })
        .sort({ joinedAt: -1 })
        .lean();
      check(
        "attendance row closed on disconnect (leftAt + durationSec set)",
        !!closedRow?.leftAt && typeof closedRow?.durationSec === "number"
      );

      const att = await admin.get(`/admin/live-sessions/${sessionId}/attendance`);
      check(
        "GET /admin/live-sessions/:id/attendance → summary",
        att.status === 200 && att.data?.data?.summary?.totalJoins >= 1,
        `${att.status} ${JSON.stringify(att.data?.data?.summary)}`
      );
    } finally {
      if (sock.connected) sock.disconnect();
    }
  } finally {
    section("Cleanup");
    const markRx = MARK.replace(/[[\]]/g, "\\$&");
    const r = await Promise.allSettled([
      LiveSessionPreview.deleteMany({ liveSessionId: { $in: created.sessions } }),
      LiveSessionAttendance.deleteMany({ liveSessionId: { $in: created.sessions } }),
      LiveCourseSubscription.deleteMany({ _id: { $in: created.subs } }),
      Video.deleteMany({ _id: { $in: created.videos } }),
      LiveSession.deleteMany({ _id: { $in: created.sessions } }),
      VideoCategory.deleteMany({ _id: { $in: created.folders } }),
      LiveCoursePlan.deleteMany({ _id: { $in: created.plans } }),
      LiveCourse.deleteMany({ _id: { $in: created.courses } }),
      PromoCode.deleteMany({ _id: { $in: created.promos } }),
    ]);
    // safety-net sweep by marker
    await Promise.allSettled([
      LiveCourse.deleteMany({ name: { $regex: markRx } }),
      VideoCategory.deleteMany({ title: { $regex: markRx } }),
      Video.deleteMany({ title: { $regex: markRx } }),
      LiveSession.deleteMany({ title: { $regex: markRx } }),
      LiveCourseSubscription.deleteMany({ liveCourseId: { $in: created.courses } }),
      PromoCode.deleteMany({ promocode: { $regex: MARK.toUpperCase().replace(/[^A-Z0-9]/g, "") } }),
      redis.del(`admin_session:${adminId}`),
      customerAId ? redis.del(`customer_session:${customerAId}`) : Promise.resolve(0),
      customerBId ? redis.del(`customer_session:${customerBId}`) : Promise.resolve(0),
    ]);
    console.log(`  cleaned ${r.filter((x) => x.status === "fulfilled").length}/9 collections + Redis key`);
    redis.disconnect();
    await mongoose.disconnect();
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`  HTTP RESULT: ${passed} passed, ${failed} failed`);
  if (failed) { console.log("  FAILURES:"); for (const f of failures) console.log(`   - ${f}`); }
  console.log("=".repeat(50));
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error("\nHTTP test run crashed:", err?.message || err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
