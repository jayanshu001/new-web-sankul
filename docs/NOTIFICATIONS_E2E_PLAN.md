# Push Notifications — End-to-End Working Plan

Goal: an admin send (`POST /api/v1/admin/notifications/broadcast` and targeted sends)
reliably reaches **both Android and iOS** devices, and the admin panel reflects the
true outcome.

Current confirmed state (2026-06-26):
- Firebase service account is configured on the server. ✅
- 29 live customers (20 iOS, 9 Android). ✅
- `ws_customer_device_token` has **0 rows** → every send marks `failed / "All sends
  failed."` and nothing is delivered. ❌ ← the thing this plan fixes.

Ownership legend: **[BE]** backend (this repo), **[APP]** mobile app team,
**[FB]** Firebase Console admin.

---

## Phase 0 — Foundations (must be true before anything can work)

Nothing downstream matters if these are wrong, so verify first.

0.1 **[FB] Single Firebase project, server matches apps.** The server's
   `FIREBASE_SERVICE_ACCOUNT` must belong to the *same* Firebase project as the apps'
   `google-services.json` (Android) and `GoogleService-Info.plist` (iOS). A project
   mismatch is the classic "token looks valid, send reports success/failure but never
   arrives" bug. Confirm the `project_id` in all three is identical.

0.2 **[FB] iOS APNs configured.** Firebase Console → Project Settings → Cloud
   Messaging → Apple app configuration: upload the **APNs Authentication Key (.p8)**
   (or cert). Without this, iOS sends fail/silently drop. Android needs nothing extra.

0.3 **[BE] Server can talk to FCM.** Confirm `initFirebase()` succeeds at boot (log
   line "Firebase Admin initialized.") and outbound to FCM isn't firewalled.

**Gate:** all three confirmed. Owner sign-off from FB before Phase 3.

---

## Phase 1 — Token registration pipeline (fill `ws_customer_device_token`)

The table is empty because no app install is registering tokens against this server.
The read path is SQL-only, so tokens MUST land in `ws_customer_device_token`.

1.1 **[BE] Verify the register endpoint works. ✅ DONE 2026-06-26 — found & fixed a real bug.**
   `upsertDeviceToken` used `where: { token }`, but the introspected NAMED unique
   (`@@unique([token], name:"uniq_device_token")`) made the query engine demand
   `where: { uniq_device_token: {...} }` — so it threw at runtime and NO token ever
   saved (the true cause of the empty table). Fixed by switching to a field-level
   `token @unique(map:"uniq_device_token")` (types + engine now agree on `{ token }`).
   Verified end-to-end via `scripts/verify-device-token.ts`. `PATCH /client/profile/
   firebase-token` (by phone) shares the same repo path and is now fixed too.
   ⚠ Restart `yarn dev` so the server loads the regenerated client.

1.2 **[APP] Register on the right triggers.** The app must:
   - Request notification permission (iOS: mandatory; Android 13+: `POST_NOTIFICATIONS`).
   - Fetch the FCM token (`getToken`), and call `PUT /client/profile/device-token`
     **after login** and on **every token refresh** (`onTokenRefresh`).
   - Send the correct `platform` value.
   - On logout, call `DELETE /client/profile/device-token` to prune.

1.3 **[APP] Android notification channel.** Android 8+ requires a notification channel
   for the notification to display. Ensure the app creates one and (optionally) the
   server payload references its `channel_id`.

1.4 **[BE] (optional) Backfill.** If a usable set of old tokens exists outside SQL,
   one-off backfill into `ws_customer_device_token`. Mongo is retired, so the realistic
   path is "apps re-register on next launch" — prefer 1.2 over a backfill.

**Gate:** real devices appear in `ws_customer_device_token` with correct `platform`.

---

## Phase 2 — Dispatch correctness & honest status [BE]

Backend changes in this repo. Each is small and gated by `yarn typecheck`.

2.1 **✅ DONE 2026-06-26. Distinguish "no recipients" from "all failed".** Today an empty token list →
   `failed / "All sends failed."`, which is misleading and hid this very issue. Change
   the status logic (both `modules/admin-notification/admin-notification.service.ts`
   and the Mongo `admin/notification/dispatcher.ts` for parity) so:
   - `attempted === 0` → status `failed` (or a distinct flag) with reason
     **"No registered devices for the selected audience."**
   - `attempted > 0 && successCount === 0` → `failed / "All sends failed."`
   - `successCount > 0` → `sent`.
   This makes the admin panel diagnostic instead of opaque.

2.2 **Confirm audience resolution.** Broadcast → all live customers' tokens; targeted
   by `platform` (`ws_customer.os_type`), `userIds`, `courseIds` (active subscribers).
   Spot-check each path returns the expected ids.

2.3 **Confirm invalid-token pruning.** A send to a dead token must prune it from
   `ws_customer_device_token` (`pruneDeviceTokens`) so failure counts shrink over time.

2.4 **Payload parity for both platforms.** Ensure the FCM message carries `notification`
   (title/body/image) for display + `data` (deepLink, type) for in-app routing.
   Consider per-platform options (Android `channel_id`/priority; iOS `sound`/`badge`)
   if product wants them.

**Gate:** `yarn typecheck` green; unit/manual check of each audience path; doc updated.

---

## Phase 3 — End-to-end verification (the proof) [BE + APP]

Do this on **real devices**, one Android + one iOS.

3.1 Install the app build pointing at this server; log in; grant notification
    permission. Confirm a row lands in `ws_customer_device_token` for each device.
3.2 **Broadcast test:** `POST /admin/notifications/broadcast` → confirm the push
    arrives on **both** devices, in **foreground and background/killed** states.
3.3 Confirm the admin log row shows `status: sent`, `recipient_count` matching the live
    token count, `failure_reason: null`.
3.4 **Targeted tests:** send to a single `userId`; send to `platform: ["ios"]` only;
    send to a `courseId`'s subscribers. Verify only the intended devices receive it.
3.5 **Deep link:** send with a `deepLink`; tapping the notification routes correctly.
3.6 **Pruning:** uninstall one app (token goes stale), send again, confirm the stale
    token is pruned and `failureCount` reflects it without blocking delivery to others.

**Gate:** every 3.x passes on both platforms.

---

## Phase 4 — Hardening & runbook [BE]

4.1 Logging/metrics: per-send `attempted/success/failure/pruned` already returned —
    surface in logs + (optionally) a metric.
4.2 Admin panel: ensure it displays `recipientCount` and the (now-honest) failure
    reason from Phase 2.1.
4.3 Runbook: short doc — "notification not arriving?" checklist (token count, project
    match, APNs, status reason) so this is self-diagnosable next time.

---

## Definition of Done (acceptance criteria)

1. A broadcast reaches both a real Android and a real iOS device (fg + bg).
2. `ws_customer_device_token` populates automatically as users log in (no manual step).
3. Admin log shows `sent` with an accurate `recipient_count`; failures carry a precise,
   actionable reason (incl. the distinct "no registered devices" case).
4. Targeted sends (user/platform/course) deliver only to the intended audience.
5. Stale tokens are pruned automatically and don't fail whole sends.
6. `yarn typecheck` passes; behavior/queries documented in
   `docs/MIGRATION_QUERY_CHANGES.md`; this plan's runbook section completed.

---

## Critical path / sequencing

```
Phase 0 (FB+BE foundations)
        └─► Phase 1 (tokens flowing: BE verify + APP register)
                    └─► Phase 3 (E2E on real devices)
Phase 2 (BE dispatch+status)  ──────────┘   (can run in parallel with Phase 1)
Phase 4 (hardening)  ───────────────────────► after Phase 3 passes
```

**Start:** Phase 0 verification + Phase 2.1 status fix (backend, immediately).
**Finish:** Phase 3 green on both platforms → Phase 4 runbook.

## What I (backend) can start now without waiting on app/console
- Phase 1.1: prove the register endpoint + repository upsert work (add a token, see it).
- Phase 2.1–2.4: status-honesty fix, audience spot-checks, pruning check, payload review.
- Phase 4.2–4.3: admin display + runbook.

The remaining gates (real FCM tokens from devices, APNs config, project-match) need the
**[APP]** and **[FB]** owners — those are the only things that can't be done from this repo.
```
