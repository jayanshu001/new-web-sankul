#!/usr/bin/env python3
"""
One-shot: reorganise the live course sections of the Postman collection into
clear, folder-wise structure and add every new endpoint.

  - Admin  > "16 Live Courses"  -> sub-folders: Courses / Plans / Folders /
             Videos / Subscriptions
  - Admin  > "15 Live Class - Sessions (Streamos)" -> + Promote Recording
  - Customer > "12 Live Courses" -> sub-folders: Browse / Live Sessions /
             Recorded Lectures / Purchase
  - adds the {{live_course_subscription_id}} collection variable

Re-runnable: existing requests are matched by name (searched recursively) and
reused, so running twice produces the same structure.

Usage:  python3 scripts/update-postman-live-course.py
"""
import json
import os

COLLECTION = os.path.join(
    os.path.dirname(__file__), "..", "docs", "Web-Sankul-API.postman_collection.json"
)


# --- builders --------------------------------------------------------------
def bearer():
    return {"type": "bearer", "bearer": [{"key": "token", "value": "{{accessToken}}", "type": "string"}]}


def make_url(raw):
    base, _, qs = raw.partition("?")
    after = base[len("{{URL}}/"):]
    u = {"raw": raw, "host": ["{{URL}}"], "path": after.split("/")}
    if qs:
        query = []
        for pair in qs.split("&"):
            k, _, v = pair.partition("=")
            query.append({"key": k, "value": v})
        u["query"] = query
    return u


def json_body(raw):
    return {"mode": "raw", "raw": raw, "options": {"raw": {"language": "json"}}}


def capture(var, json_path):
    """A test script that stashes a value from the response into a variable."""
    return [{
        "listen": "test",
        "script": {
            "type": "text/javascript",
            "exec": [
                'pm.test("2xx", () => pm.expect(pm.response.code).to.be.below(300));',
                "try {",
                f"  const v = pm.response.json()?.{json_path};",
                f'  if (v) {{ pm.collectionVariables.set("{var}", v); pm.environment.set("{var}", v); }}',
                "} catch (e) {}",
            ],
        },
    }]


def req(name, method, raw, description=None, body=None, json=False, event=None):
    r = {"method": method, "header": [], "url": make_url(raw), "auth": bearer()}
    if json:
        r["header"] = [{"key": "Content-Type", "value": "application/json"}]
    if description:
        r["description"] = description
    if body is not None:
        r["body"] = body
    item = {"name": name, "request": r, "response": []}
    if event:
        item["event"] = event
    return item


def folder(name, items, description=None):
    f = {"name": name, "item": items}
    if description:
        f["description"] = description
    return f


# --- collection helpers ----------------------------------------------------
def find_child(items, name):
    for it in items:
        if it.get("name") == name:
            return it
    return None


def find_request_recursive(node, name):
    """Find a leaf request item by name anywhere under node['item']."""
    for it in node.get("item", []):
        if it.get("name") == name and "request" in it:
            return it
        if "item" in it:
            hit = find_request_recursive(it, name)
            if hit:
                return hit
    return None


def reuse_or(node, name, builder):
    """Reuse an existing request item by name, else build a fresh one."""
    existing = find_request_recursive(node, name)
    return existing if existing else builder()


def main():
    path = os.path.abspath(COLLECTION)
    with open(path, encoding="utf-8") as f:
        c = json.load(f)

    # ── collection variable ────────────────────────────────────────────────
    var_keys = {v.get("key") for v in c.get("variable", [])}
    if "live_course_subscription_id" not in var_keys:
        c.setdefault("variable", []).append(
            {"key": "live_course_subscription_id", "value": ""}
        )

    admin = find_child(c["item"], "Admin APIs")
    customer = find_child(c["item"], "Customer APIs")

    # ══════════════════════════════════════════════════════════════════════
    # ADMIN  >  16 Live Courses   (reorganised into sub-folders)
    # ══════════════════════════════════════════════════════════════════════
    lc16 = find_child(admin["item"], "16 Live Courses")

    courses_folder = folder("01 Courses", [
        reuse_or(lc16, "List Live Courses", lambda: req(
            "List Live Courses", "GET",
            "{{URL}}/api/v1/admin/live-courses?page=1&limit=20&search=&status=")),
        reuse_or(lc16, "Create Live Course", lambda: req(
            "Create Live Course", "POST", "{{URL}}/api/v1/admin/live-courses")),
        reuse_or(lc16, "Get Live Course", lambda: req(
            "Get Live Course", "GET",
            "{{URL}}/api/v1/admin/live-courses/{{live_course_id}}")),
        reuse_or(lc16, "Update Live Course", lambda: req(
            "Update Live Course", "PUT",
            "{{URL}}/api/v1/admin/live-courses/{{live_course_id}}")),
        reuse_or(lc16, "Toggle Popular", lambda: req(
            "Toggle Popular", "PATCH",
            "{{URL}}/api/v1/admin/live-courses/{{live_course_id}}/popular")),
        reuse_or(lc16, "List Sessions Under Course", lambda: req(
            "List Sessions Under Course", "GET",
            "{{URL}}/api/v1/admin/live-courses/{{live_course_id}}/sessions?upcoming=&status=&page=1&limit=50")),
        reuse_or(lc16, "Delete Live Course", lambda: req(
            "Delete Live Course", "DELETE",
            "{{URL}}/api/v1/admin/live-courses/{{live_course_id}}")),
        req("Timetable Files: Set", "PATCH",
            "{{URL}}/api/v1/admin/live-courses/{{live_course_id}}/timetable-files",
            description="Replace the whole 'Time Table' file list shown on the Schedule tab. Upload the PDFs via the generic upload endpoint first, then send the resulting URLs here.",
            json=True,
            body=json_body('{\n  "files": [\n    { "title": "Batch Time Table", "fileUrl": "https://cdn.example.com/timetable.pdf", "order": 0 }\n  ]\n}')),
    ], description="CRUD for the live course itself. Creating a course auto-creates its root VideoCategory folder. Course create/update also accepts `classType` (live | live_offline | offline).")

    plans_folder = folder("02 Plans", [
        reuse_or(lc16, "Plans: List", lambda: req(
            "Plans: List", "GET",
            "{{URL}}/api/v1/admin/live-courses/{{live_course_id}}/plans")),
        reuse_or(lc16, "Plans: Create", lambda: req(
            "Plans: Create", "POST",
            "{{URL}}/api/v1/admin/live-courses/{{live_course_id}}/plans")),
        reuse_or(lc16, "Plans: Get One", lambda: req(
            "Plans: Get One", "GET",
            "{{URL}}/api/v1/admin/live-courses/plans/{{live_course_plan_id}}")),
        reuse_or(lc16, "Plans: Update", lambda: req(
            "Plans: Update", "PUT",
            "{{URL}}/api/v1/admin/live-courses/plans/{{live_course_plan_id}}")),
        reuse_or(lc16, "Plans: Delete", lambda: req(
            "Plans: Delete", "DELETE",
            "{{URL}}/api/v1/admin/live-courses/plans/{{live_course_plan_id}}")),
    ], description="Pricing plans (duration in MONTHS + price). One plan per course can be `isDefault`.")

    folders_folder = folder("03 Folders", [
        reuse_or(lc16, "Folders: List", lambda: req(
            "Folders: List", "GET",
            "{{URL}}/api/v1/admin/live-courses/{{live_course_id}}/folders")),
        reuse_or(lc16, "Folders: Create", lambda: req(
            "Folders: Create", "POST",
            "{{URL}}/api/v1/admin/live-courses/{{live_course_id}}/folders")),
        reuse_or(lc16, "Folders: Update", lambda: req(
            "Folders: Update", "PATCH",
            "{{URL}}/api/v1/admin/live-courses/{{live_course_id}}/folders/{{live_course_folder_id}}")),
        reuse_or(lc16, "Folders: Delete", lambda: req(
            "Folders: Delete", "DELETE",
            "{{URL}}/api/v1/admin/live-courses/{{live_course_id}}/folders/{{live_course_folder_id}}")),
    ], description="VideoCategory folders that hold the course's recorded lectures. The root folder cannot be deleted.")

    videos_folder = folder("04 Videos (in a folder)", [
        reuse_or(lc16, "Videos: List in Folder", lambda: req(
            "Videos: List in Folder", "GET",
            "{{URL}}/api/v1/admin/live-courses/{{live_course_id}}/folders/{{live_course_folder_id}}/videos")),
        reuse_or(lc16, "Videos: Get One", lambda: req(
            "Videos: Get One", "GET",
            "{{URL}}/api/v1/admin/live-courses/{{live_course_id}}/folders/{{live_course_folder_id}}/videos/{{live_course_video_id}}")),
        reuse_or(lc16, "Videos: Add Manual", lambda: req(
            "Videos: Add Manual", "POST",
            "{{URL}}/api/v1/admin/live-courses/{{live_course_id}}/folders/{{live_course_folder_id}}/videos")),
        reuse_or(lc16, "Videos: Add from Live Recording", lambda: req(
            "Videos: Add from Live Recording", "POST",
            "{{URL}}/api/v1/admin/live-courses/{{live_course_id}}/folders/{{live_course_folder_id}}/videos/from-recording")),
        req("Videos: Update", "PUT",
            "{{URL}}/api/v1/admin/live-courses/{{live_course_id}}/folders/{{live_course_folder_id}}/videos/{{live_course_video_id}}",
            description="Update any subset of a video's fields. The update is scoped to this folder, so a videoId from another folder is rejected with 404.",
            json=True,
            body=json_body('{\n  "title": "Live Class — Week 1 (replay, edited)",\n  "priceType": "paid",\n  "order": 1,\n  "status": true\n}')),
        req("Videos: Reorder", "POST",
            "{{URL}}/api/v1/admin/live-courses/{{live_course_id}}/folders/{{live_course_folder_id}}/videos/reorder",
            description="Bulk-set the `order` of videos in this folder. Only ids that actually live in the folder are touched; stray ids are ignored. Response returns `{ matched, modified }`.",
            json=True,
            body=json_body('{\n  "orders": [\n    { "id": "{{live_course_video_id}}", "order": 0 }\n  ]\n}')),
        reuse_or(lc16, "Videos: Delete", lambda: req(
            "Videos: Delete", "DELETE",
            "{{URL}}/api/v1/admin/live-courses/{{live_course_id}}/folders/{{live_course_folder_id}}/videos/{{live_course_video_id}}")),
    ], description="Recorded lectures inside a folder. A video may be added manually, or promoted from a past live session's Streamos recording.")

    subs_folder = folder("05 Subscriptions", [
        req("List Subscriptions (all)", "GET",
            "{{URL}}/api/v1/admin/live-courses/subscriptions?customerId=&liveCourseId=&planId=&paymentStatus=&status=&page=1&limit=20",
            description="List LiveCourseSubscription rows. All filters optional. `paymentStatus` = pending | verified | failed; `status` = true | false."),
        req("List Subscriptions for Course", "GET",
            "{{URL}}/api/v1/admin/live-courses/{{live_course_id}}/subscriptions?page=1&limit=20",
            description="Same as above but pre-scoped to one live course via the path id."),
        req("Get Subscription", "GET",
            "{{URL}}/api/v1/admin/live-courses/subscriptions/{{live_course_subscription_id}}",
            description="Fetch a single subscription with customer / live course / plan populated."),
        req("Grant Subscription (free-grant)", "POST",
            "{{URL}}/api/v1/admin/live-courses/{{live_course_id}}/grant",
            description="Hand a customer an active, verified subscription with no payment (paidAmount = 0). Window comes from the plan's duration unless you pass `durationMonths`, `startAt`, or `endAt`. Returns 409 if the customer already has an active subscription to this course — extend it via the update endpoint instead.",
            json=True,
            body=json_body('{\n  "customerId": "{{customer_id}}",\n  "planId": "{{live_course_plan_id}}"\n}'),
            event=capture("live_course_subscription_id", "data?.subscription?._id")),
        req("Update Subscription (extend / revoke)", "PUT",
            "{{URL}}/api/v1/admin/live-courses/subscriptions/{{live_course_subscription_id}}",
            description="Extend (`endAt`), revoke (`status: false`), or correct `paymentStatus`. At least one field required.",
            json=True,
            body=json_body('{\n  "endAt": "2026-12-31T23:59:59.000Z",\n  "status": true\n}')),
        req("Delete Subscription", "DELETE",
            "{{URL}}/api/v1/admin/live-courses/subscriptions/{{live_course_subscription_id}}",
            description="Hard delete — for test / erroneous rows. To revoke a real customer prefer Update with `status: false`, which keeps the audit trail."),
    ], description="Admin view of who is subscribed, plus the manual free-grant flow and extend / revoke controls.")

    lc16["item"] = [courses_folder, plans_folder, folders_folder, videos_folder, subs_folder]
    lc16["description"] = (
        "Admin management of live courses, organised folder-wise:\n"
        "- **01 Courses** — the live course entity (CRUD + popular toggle + sessions list)\n"
        "- **02 Plans** — pricing plans\n"
        "- **03 Folders** — VideoCategory folders for recorded lectures\n"
        "- **04 Videos** — recorded lectures inside a folder (manual or promoted from a recording)\n"
        "- **05 Subscriptions** — subscriber list, free-grant, extend / revoke"
    )

    # ══════════════════════════════════════════════════════════════════════
    # ADMIN  >  15 Live Class - Sessions (Streamos)   (+ Promote Recording)
    # ══════════════════════════════════════════════════════════════════════
    lc15 = find_child(admin["item"], "15 Live Class — Sessions (Streamos)")
    if lc15 is None:  # fall back to a looser match on the prefix
        for it in admin["item"]:
            if it.get("name", "").startswith("15 Live Class"):
                lc15 = it
                break
    if lc15 is not None and not find_request_recursive(lc15, "Promote Recording to Folder"):
        promote = req(
            "Promote Recording to Folder", "POST",
            "{{URL}}/api/v1/admin/live-sessions/{{live_session_id}}/promote-recording",
            description=(
                "Promote one of this session's Streamos recordings into ANY VideoCategory "
                "folder as a Video — the folder may belong to a live course OR a recorded "
                "course, so recordings can be filed wherever they are needed. Pick the "
                "recording by `recordingIndex` (0-based) or `quality`; omit both for the "
                "best quality. Idempotent per folder: re-promoting returns the existing "
                "Video. The created Video keeps a `liveSessionId` back-link.\n\n"
                "`:id` accepts either the Mongo session `_id` or the numeric `streamId`."
            ),
            json=True,
            body=json_body(
                '{\n  "folderId": "{{live_course_folder_id}}",\n'
                '  "quality": "720p",\n'
                '  "title": "Live Class — Week 1 (replay)"\n}'
            ),
        )
        # place it right after "Start Scheduled Session" if present, else append
        names = [x.get("name") for x in lc15["item"]]
        idx = names.index("Start Scheduled Session") + 1 if "Start Scheduled Session" in names else len(lc15["item"])
        lc15["item"].insert(idx, promote)

    # Document the timetable metadata fields (subject / educatorId / endAt) on
    # the session create + schedule bodies — these feed the Schedule tab.
    if lc15 is not None:
        sched = find_request_recursive(lc15, "Schedule Live Session")
        if sched and sched.get("request", {}).get("body", {}).get("mode") == "raw":
            sched["request"]["body"]["raw"] = (
                '{\n'
                '  "title": "Tomorrow 7pm Live",\n'
                '  "subject": "Current Affairs",\n'
                '  "educatorId": "{{educator_id}}",\n'
                '  "scheduledAt": "2026-05-15T19:00:00.000Z",\n'
                '  "endAt": "2026-05-15T20:00:00.000Z",\n'
                '  "liveCourseIds": ["{{live_course_id}}"],\n'
                '  "recordingTargetFolderId": "{{live_course_folder_id}}"\n'
                '}'
            )
        imm = find_request_recursive(lc15, "Create Live Session (immediate)")
        if imm and imm.get("request", {}).get("body", {}).get("mode") == "raw":
            imm["request"]["body"]["raw"] = (
                '{\n'
                '  "title": "Live Class Title",\n'
                '  "subject": "Current Affairs",\n'
                '  "educatorId": "{{educator_id}}",\n'
                '  "endAt": "2026-05-14T20:00:00.000Z",\n'
                '  "liveCourseIds": ["{{live_course_id}}"],\n'
                '  "recordingTargetFolderId": "{{live_course_folder_id}}"\n'
                '}'
            )

    # ══════════════════════════════════════════════════════════════════════
    # CUSTOMER  >  12 Live Courses   (reorganised into sub-folders)
    # ══════════════════════════════════════════════════════════════════════
    cust12 = find_child(customer["item"], "12 Live Courses")

    browse_folder = folder("01 Browse", [
        reuse_or(cust12, "List Live Courses", lambda: req(
            "List Live Courses", "GET",
            "{{URL}}/api/v1/client/live-courses?page=1&limit=20&search=")),
        reuse_or(cust12, "Get Live Course", lambda: req(
            "Get Live Course", "GET",
            "{{URL}}/api/v1/client/live-courses/{{live_course_id}}")),
        req("My Live Courses", "GET",
            "{{URL}}/api/v1/client/live-courses/my?status=all",
            description="The customer's own live course subscriptions. `status` = active | expired | all (default all). Each row carries the live course, plan, start/end window and a computed `active` flag."),
    ], description="Discover live courses and see what the customer already owns.")

    sessions_folder = folder("02 Live Sessions", [
        reuse_or(cust12, "Sessions Under Live Course", lambda: req(
            "Sessions Under Live Course", "GET",
            "{{URL}}/api/v1/client/live-courses/{{live_course_id}}/sessions?upcoming=&status=&page=1&limit=50")),
        req("Get Live Session (access gate + preview)", "GET",
            "{{URL}}/api/v1/client/live-sessions/{{live_session_id}}",
            description=(
                "Playback info for one session, with the entitlement gate applied:\n"
                "- `accessLevel`: `full` (subscriber or open session) | `preview` (inside the "
                "per-viewer trial) | `preview_ended` (trial elapsed).\n"
                "- `previewSeconds` (180), `previewExpiresAt`, `previewSecondsRemaining`.\n"
                "- `hlsUrl` / `hlsUrls` / `recordings` are returned ONLY for `full` and "
                "`preview`. Once `preview_ended` they are withheld — the 3-minute cutoff is "
                "enforced **server-side**, per viewer, not client-trusted.\n"
                "- `purchaseOptions[]`: every attached live course + its plans, so the user "
                "can buy ANY one of them to unlock. Sent during `preview` too, so the popup "
                "is ready the moment the timer hits zero.\n\n"
                "`:id` accepts the Mongo session `_id` or the numeric `streamId`."
            )),
    ], description="Watch a live class. Non-subscribers get a server-enforced 3-minute per-viewer preview, then a purchase popup.")

    recordings_folder = folder("03 Recorded Lectures", [
        req("List Recorded Live Classes (Streamos)", "GET",
            "{{URL}}/api/v1/client/live-courses/{{live_course_id}}/session-recordings?page=1&limit=50",
            description="The flat list of recorded live classes for the course — every ENDED/READY live session that carries Streamos-delivered recordings. Surfaces the raw Streamos recording straight off the session, so a class shows up even before an admin files it into a folder. Metadata only (title, date, available `qualities`, `recordingCount`, `locked`) — the mp4 URLs are NOT here. To watch one, open `02 Live Sessions → Get Live Session` with the item's `sessionId`; that endpoint applies the per-viewer preview / subscription gate. Non-subscribers also get `purchaseOptions`."),
        req("List Recordings — Folder Lectures", "GET",
            "{{URL}}/api/v1/client/live-courses/{{live_course_id}}/recordings",
            description="Recorded lectures grouped by folder — Videos an admin promoted into VideoCategory folders (plus any manually added videos). Distinct from the Streamos session-recordings list above. The folder/lecture structure is always returned; a lecture's `videoUrl` is included only for subscribers (or free lectures) — locked lectures carry `locked: true`. Non-subscribers also get `purchaseOptions`."),
        req("Get Lecture (folder video)", "GET",
            "{{URL}}/api/v1/client/live-courses/{{live_course_id}}/lecture/{{live_course_video_id}}",
            description="Gated single-lecture playback for a folder video. Verifies the video belongs to a folder of this live course, then requires an active subscription unless the lecture is free. On 403 the response `data` carries `purchaseOptions`."),
    ], description="Recorded lectures, two ways:\n- **Streamos session recordings** — the raw recordings off each past live session (use the session-recordings list, then open the session to watch).\n- **Folder lectures** — Videos an admin promoted into folders (use the folder recordings list + Get Lecture).")

    purchase_folder = folder("04 Purchase", [
        req("Payment: Apply Promo (preview)", "POST",
            "{{URL}}/api/v1/client/payment/apply-promo/live-course",
            description="Preview-only: validates a promo code against a plan and returns `{ originalAmount, discountAmount, finalAmount, discountType, discountValue, ... }` so the UI can show the discounted total before checkout. The discount is always re-validated inside create-order — this result is never trusted on its own. Live courses use the promo-level discount on the PromoCode (discountType + discountValue); any active code within its window applies.",
            json=True,
            body=json_body('{\n  "planId": "{{live_course_plan_id}}",\n  "promocode": "WELCOME10"\n}')),
        req("Payment: Create Order (Live Course)", "POST",
            "{{URL}}/api/v1/client/payment/create-order/live-course",
            description="Creates a pending `LiveCourseSubscription` + a Razorpay order. `promocode` is OPTIONAL — when present, a promo-level discount is applied and the order is created for the reduced amount (always re-validated server-side; a code that drops the price below ₹1 is rejected). After Razorpay checkout, POST the returned ids to `Customer → Payment → Verify` — the live course branch flips the subscription to verified and computes start/end from the plan duration. The Razorpay webhook also fulfils it as a safety net. Returns 409 if the customer already has an active subscription to this live course.",
            json=True,
            body=json_body('{\n  "planId": "{{live_course_plan_id}}",\n  "promocode": ""\n}')),
    ], description="Buy a live course, optionally with a promo code. After Razorpay checkout, POST the ids to `Customer → Payment → Verify` — the live course branch flips the subscription to verified. The Razorpay webhook also fulfils it as a safety net.")

    schedule_folder = folder("05 Schedule", [
        req("Course Schedule (timetable + files)", "GET",
            "{{URL}}/api/v1/client/live-courses/{{live_course_id}}/schedule?upcoming=",
            description="The Schedule tab. Returns `timetable` (rows derived from the course's scheduled live sessions — subject, educator, date, start/end time) and `files` (the uploaded 'Time Table' PDFs). Not entitlement-gated — it's course info shown to everyone. `?upcoming=true` limits the timetable to classes from now onward."),
    ], description="The course's study timetable, derived from its scheduled live sessions, plus the uploaded timetable files.")

    reminders_folder = folder("06 Reminders", [
        req("Set Reminder", "POST",
            "{{URL}}/api/v1/client/live-reminders",
            description=(
                "Set (or replace) the caller's reminder for a SCHEDULED live session. "
                "`minutesBefore` is optional — default 30, max 10080 (1 week). The "
                "reminder push fires that many minutes before the session's "
                "`scheduledAt`; if the class is sooner than `minutesBefore`, it fires "
                "almost immediately instead of in the past.\n\n"
                "Upserts on (customer, session) — calling it again just moves the fire "
                "time. Returns the reminder with its `session` summary populated. "
                "Errors: 404 session not found, 409 session is not SCHEDULED / has no "
                "upcoming time, 422 bad `liveSessionId` or `minutesBefore`."
            ),
            json=True,
            body=json_body('{\n  "liveSessionId": "{{live_session_id}}",\n  "minutesBefore": 30\n}')),
        req("List My Reminders", "GET",
            "{{URL}}/api/v1/client/live-reminders?upcoming=true",
            description=(
                "The caller's reminders, soonest first. `?upcoming=true` keeps only "
                "still-scheduled reminders whose session start is still in the future; "
                "omit it for ALL reminders (including fired / cancelled ones). Each row "
                "carries the populated `session` summary and a derived `fired` flag "
                "(the scheduled fire time has already passed)."
            )),
        req("Get Reminder for Session", "GET",
            "{{URL}}/api/v1/client/live-reminders/session/{{live_session_id}}",
            description=(
                "Whether the caller already has a reminder on this session — drives the "
                "per-session 'reminder on / off' toggle. `data.reminder` is the reminder "
                "object, or `null` when none is set."
            )),
        req("Remove Reminder", "DELETE",
            "{{URL}}/api/v1/client/live-reminders/{{live_session_id}}",
            description=(
                "Remove the caller's reminder for a session and cancel its pending "
                "notification. Note the path id is the **liveSessionId**, not the "
                "reminder id. 404 if no reminder was set."
            )),
    ], description="Per-session 'remind me' for upcoming SCHEDULED live classes. A reminder is delivered as a push notification (FCM, `type: \"live_reminder\"`) `minutesBefore` the class starts — default 30 min. One reminder per customer per session.")

    cust12["item"] = [browse_folder, sessions_folder, recordings_folder, purchase_folder, schedule_folder, reminders_folder]
    cust12["description"] = (
        "Customer-facing live courses, organised folder-wise:\n"
        "- **01 Browse** — list / detail (header stats + plan discount) / my subscriptions\n"
        "- **02 Live Sessions** — watch live, with the server-enforced per-viewer preview\n"
        "- **03 Recorded Lectures** — course-wise recordings + gated single-lecture playback\n"
        "- **04 Purchase** — create the Razorpay order\n"
        "- **05 Schedule** — the study timetable + timetable files\n"
        "- **06 Reminders** — per-session 'remind me' for upcoming SCHEDULED classes\n\n"
        "**Entitlement:** a non-subscriber gets a server-enforced 3-minute per-viewer preview "
        "of a live session; after that, playback URLs are withheld and `purchaseOptions` lists "
        "every attached course + plan. Buying ANY attached course unlocks the session."
    )

    # ── write back (preserve original 2-space / ascii style) ───────────────
    with open(path, "w", encoding="utf-8") as f:
        json.dump(c, f, indent=2, ensure_ascii=True)
        f.write("\n")

    print("Updated:", path)


if __name__ == "__main__":
    main()
