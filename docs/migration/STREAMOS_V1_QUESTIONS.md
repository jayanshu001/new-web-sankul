# StreamOS v1 API — Open Questions for the StreamOS Team (2026-09-01)

> ## 🔌 FIRST LIVE PROBE 2026-09-09 — key works; two docs-vs-reality gaps
>
> `sk_live_…` received and set. `scripts/probe-streamos-v1.ts` run read-only against the
> real API. **Authentication, envelope, `/assets/`, `/assets/{id}/` and `/livestreams/`
> all behave as documented.** The organization already holds 60 assets and 0 livestreams.
>
> | Finding | Severity | Action |
> |---|---|---|
> | `renditions[].playlist_url`, not `.url` as documented | **Bug — every rendition silently dropped, so finished recordings showed none** | Fixed in `toAsset()` |
> | `video.hls_manifest_url` null on COMPLETED, non-DRM assets | Degradation — no ABR master, `recordings[0]` becomes 240p | Tolerated; ask StreamOS |
> | 720p rendition `playlist_url` points at the 480p path | Vendor bug | Raise with StreamOS |
>
> **Add to the StreamOS ask:**
> - Why is `video.hls_manifest_url` null on COMPLETED assets that are not DRM? The docs
>   describe it as the single playback URL.
> - The 720p rendition URL resolves to the 480p directory.
>
> ### Still outstanding before any v1 cutover
>
> 1. **Q2 / Q4** — unchanged, and still the only true blockers. Worth adding: if the old
>    URLs are being retired, how long do they stay readable, so the back catalogue can be
>    re-ingested via `POST /videos/` with `source_url`?
> 2. **Webhook not registered.** `STREAMOS_WEBHOOK_SIGNING_SECRET` is still empty. It is
>    returned once by `POST /webhooks/`, which needs a **public HTTPS URL** — so this must
>    be done from staging or production, never from a laptop. Until it is set,
>    `verifyStreamosSignature` rejects every delivery with 401 and **recordings never
>    attach to sessions.**
> 3. **Encoding settings** must be configured org-wide in the dashboard, or
>    `POST /livestreams/{id}/start/` returns `409 TRANSCODE_NOT_CONFIGURED` at go-live.
> 4. **DDL on staging + production** — `2026-09-01_streamos_v1_live_session.sql`, verified
>    on the dev DB only.
> 5. **Write path unproven.** `PROBE_WRITE=1` exercises create + end, but takes a slot from
>    the shared org pool. Run it outside class hours before the first real class.

> ## ✅ VERDICT 2026-09-09 — full docs re-read; only Q2 and Q4 still block
>
> Re-read `https://streamos.in/docs` end to end (`/authentication`, `/errors`, `/livestreams`,
> `/playback`, `/webhooks`, `/webhooks/events`). **Five of the eight questions are now answered
> by the documentation itself and should NOT be sent.** What is left is not technical.
>
> | # | Status | Answer from the docs |
> |---|---|---|
> | 1 | **ANSWERED** | `VIDEO_TRANSCODING_COMPLETED` carries a `stream` object with `id` (the livestream public id) **and** `stream_key`. `LIVESTREAM_RECORDING_READY` carries only `recording.asset_id` — *"the only place it is announced — keep it."* Our `resolveSession` already tries stream_key → customTags → stream.public_id → recorded_asset_id, which covers both events. **No longer a blocker.** |
> | 2 | **STILL OPEN — the only real blocker** | The new docs contain **zero references** to `streamapi.streamos.co`. No migration guide, no deprecation notice, nothing about existing assets. Cannot be resolved by reading; must come from StreamOS. |
> | 3 | **ANSWERED** | `409 API_KEY_EXISTS` — one live key per organization. Confirms staging and prod share one credential; `STREAMOS_ENV_TAG` + the `wsEnv` tag is the mitigation, already implemented. |
> | 4 | **STILL OPEN** | Not addressed anywhere in the docs. The legacy `createStream` now returning **400** (2026-09-09, see `MIGRATION_QUERY_CHANGES.md`) suggests it is already being wound down. |
> | 5 | **ANSWERED** | Verbatim: *"No `LIVE` status exists. The API has no signal for encoder connection, so active broadcasts remain marked `READY_TO_STREAM`."* Our `deriveIsLiveV1` heuristic is the correct and only option. Abandoned streams auto-close after 24h. |
> | 6 | **ANSWERED** | Concurrency + trial limits are enforced **at stream start, not at scheduling**; `POST /livestreams/` is 10/min per organization; slots are a shared org-wide pool freed by `POST /livestreams/{id}/end/`. |
> | 7 | **ANSWERED** | DRM assets *"currently cannot be played"* — no licence server; `hls_manifest_url` returns `null` and output is DASH. Additionally `drm` on livestream create is now **ignored entirely** (documented breaking change). We already send `drm: false` and the webhook already refuses DRM/DASH-only payloads. |
> | 8 | **STILL UNDOCUMENTED** | Pagination is not described. Low impact — nothing paginates the asset library today. |
>
> ### New facts found on this read (not previously captured)
>
> 1. **`TRANSCODE_NOT_CONFIGURED` (409) on `POST /livestreams/{id}/start/`** — *"Encoding settings
>    must be configured organization-wide; unconfigured orgs receive `TRANSCODE_NOT_CONFIGURED`
>    on start attempt."* **This is a dashboard pre-flight the account owner must complete before
>    the first v1 go-live**, and it fails at exactly the moment an admin presses Go Live. Newly
>    added to the owner's checklist.
> 2. **Webhook signature payload is `{timestamp}.{rawBody}`** — previously marked UNCONFIRMED in
>    `utils/streamosSignature.ts`. Comment corrected; the body-only fallback is retained until a
>    real delivery logs `scheme: "timestamped"`.
> 3. **Webhook delivery contract**: 6 retries at ~1m / 5m / 25m / 2h / 10h, **2xx required within
>    10 seconds**. Our handler claims the delivery id before doing any work, so a slow
>    auto-promote produces ignored replays rather than duplicated `ws_video` rows — acceptable,
>    but the 10s ceiling is now a known constraint on `applyEvent`.
> 4. **Playback manifests are public**: *"no token, no expiry and no sign-in… treat the URL as
>    the secret."* Our `utils/videoEncryption.ts` wrapper already keeps them off the client, so
>    the contract is unchanged — but a leaked v1 manifest URL never expires.
> 5. **OBS**: `rtmp_url` embeds the signature — paste into Server, leave Stream Key **blank**.
>    `rtmp_server_url` / `rtmp_server_key` are returned separately for split-credential encoders
>    (already mapped in `streamos.v1.service.ts:218`).
> 6. **Push credentials expire 24h after minting** — confirms the provision/start split in
>    `streamos.provider.ts` (reserve at schedule, mint at go-live) is the correct design.
>
> ### Verdict on the code
>
> **No implementation change is required by these docs.** The v1 client, provider facade,
> webhook handler and signature verifier all match the published contract. What remains is
> operational: credentials, the encoding-settings pre-flight, DDL on staging/prod, and the
> two vendor answers (Q2, Q4).

> ## ⚠ CORRECTION 2026-09-01 — Q1 was based on a misreading
>
> **A correlation field IS documented.** The v1 **Video payload** carries a `stream`
> object described verbatim as *"Set when the asset is a live stream recording, so you
> can tie it back to the broadcast"*, holding **`stream_key`**. The `VIDEO_UPLOADED`
> sample shows `"stream": null`, consistent with an upload having no broadcast.
>
> The original Q1 ("the payload carries no stream id") was drawn from the abbreviated
> `LIVESTREAM_RECORDING_READY` table and is **wrong as written — do not send it.**
>
> What survives is much narrower:
> - `stream` carries `stream_key`, **not** the `public_id` we store as `streamId`, so
>   correlation matches on `ws_live_session.stream_key`. Code updated accordingly.
> - `LIVESTREAM_RECORDING_READY` still appears to expose only `recording.asset_id`
>   (its own docs call it *"the only place it is announced"*), so the FIRST event of the
>   pair may be uncorrelatable. Tolerable — it only stores a pointer, while
>   `VIDEO_TRANSCODING_COMPLETED` (the event that publishes the recording) does carry
>   the stream.
>
> **Q3 (API keys) is confirmed and stronger than stated.** Verbatim from `/docs/errors`:
> `409 API_KEY_EXISTS` — *"One key is live per organization. Revoke the current one
> before creating another."* And limits are org-wide, not per key: `POST /livestreams/`
> is *"10 / minute per organization — Stream slots are a finite shared pool"*, and
> `POST /videos/` is *"capped for the org across every key and the dashboard together"*.
> A second key would not even grant staging its own quota.

> **Status: BLOCKED — awaiting answers from StreamOS.** Questions 1–3 block implementation.
> Source: the new docs at <https://streamos.in/docs> (`/authentication`, `/errors`, `/videos`,
> `/assets`, `/playback`, `/livestreams`, `/webhooks`, `/webhooks/events`), read 2026-09-01.

## Why this doc exists

StreamOS has shipped a **new API on a new host** — `https://api.streamos.in/api/public/v1/*`.
Our entire live-streaming + recording integration currently targets the **old** platform at
`https://streamapi.streamos.co/streamos/*` (see `src/admin/live/streamos.service.ts`).

**The new docs contain no migration guide, no deprecation notice, and no reference to the old
API at all.** They read as a fresh product doc, not a v1→v2 upgrade path. Everything we know
about "what changed" is our own diff of their new spec against our existing call sites — not
something StreamOS has published.

The questions below are the gaps that are **not answerable from the documentation** and that we
cannot safely guess at. Two of them (Q1, Q2) can break production silently if we assume wrong.

---

## The message sent to the StreamOS group

> Hi team,
>
> We've gone through the new docs at streamos.in/docs and started planning the integration.
> Before we build, we have a few questions that we couldn't find answers to in the documentation
> — the first three are blocking for us.
>
> **1. Recording → stream correlation (blocker)**
> In the event reference, `LIVESTREAM_RECORDING_READY` returns only `recording.asset_id`, and
> `VIDEO_TRANSCODING_COMPLETED` returns only `video.id`. Neither payload appears to include the
> livestream's `public_id`.
>
> We need to attribute a finished recording back to the specific live session it came from.
> Could you confirm:
> - Does the recording event include the source livestream's `public_id`?
> - If not, do `customTags` set on `POST /livestreams/` propagate to the resulting recording
>   asset's `tags`? If so we can stamp our own session id there.
>
> Without one of these, we have no way to know which class a recording belongs to.
>
> **2. What happens to our existing videos and URLs? (blocker)**
> The message mentioned old videos will be added to the new panel soon. All of our stored
> playback URLs currently point at the old CDN.
> - Will the existing URLs continue to work after the migration?
> - If not, will we get a mapping from old video → new `public_id` so we can re-resolve them?
>
> We have a large back catalogue, so if old URLs stop resolving we need to plan a bulk re-resolve
> before that happens.
>
> **3. Separate API keys per environment (blocker)**
> The authentication doc says only one key can be active per organisation, and creating a second
> returns `409 API_KEY_EXISTS`. We run separate staging and production environments that both
> need to talk to StreamOS.
> - Is there a way to get separate keys per environment, or a separate sub-organisation for staging?
> - For rotation, the docs mention a gap where nothing authenticates — is there any overlap window
>   planned, or should we schedule rotations as brief downtime?
>
> **4. Is the old API being retired, and when?**
> The new docs don't mention the previous API (`streamapi.streamos.co`) at all. Could you confirm
> whether it's being deprecated, and if so the timeline? We'd like to know whether we're building
> a permanent switchover or need to support both for a period.
>
> **5. Detecting that a stream is actually live**
> The livestreams doc notes there's no `LIVE` status and a stream in progress still reads
> `READY_TO_STREAM`. We show a "Live now" state to students, so we need to know when an encoder
> is actually connected.
> - Is a livestream-started event or an ingest-connected status on the roadmap?
> - In the meantime, is polling the HLS manifest the approach you'd recommend?
>
> **6. Concurrency limits**
> `503 NO_SLOTS_AVAILABLE` is documented but not the actual numbers. How many concurrent live
> streams does our account allow? We need to know before scheduling overlapping classes.
>
> **7. DRM licence server**
> The playback doc says DRM assets can't currently be played as the licence server isn't available
> yet. Any ETA? We'll upload with `drm: false` for now, but we'd like to plan for enabling it.
>
> **8. Pagination**
> `GET /assets/` and `GET /livestreams/` don't document any pagination parameters. What's the
> default page size and how do we page through a large library?
>
> Thanks — happy to jump on a call if that's easier for any of these.

---

## Why each question blocks us (internal notes — not sent)

| # | Question | What it blocks | If we guess wrong |
|---|---|---|---|
| 1 | Recording → stream correlation | `recordingWebhook` in `src/admin/live/live.controller.ts:965` finds the session via `updateByStreamId(body.streamId)`. With the documented payloads that lookup is **impossible**. | Recordings arrive and can't be attributed to any class. The auto-promote into course folders (`maybeAutoPromoteRecordingSql`) cannot run at all. |
| 2 | Existing video URLs | Every URL in `ws_live_session.recordings` / `mp4_recordings` and every promoted `ws_video` row points at the old CDN. | The **entire recorded back catalogue** goes dark with no warning, on their migration date rather than our deploy date. |
| 3 | One API key per org | Staging and prod would share one credential; rotating it takes both down. | Either no staging integration, or a shared key we can't rotate safely. |
| 4 | Old API sunset | Decides whether the provider flag is a temporary bridge or a permanent dual-path. | We either over-build a dual-path we don't need, or lose all old sessions when they pull the plug. |
| 5 | Live detection | `isLive` drives the student player, the "Live Now" badge, and the 3-minute live-preview watch-time gate. There is **no provider-side source for it any more**. | We must derive it from session status + schedule window; accuracy of the Live Now badge degrades. |
| 6 | Concurrency limits | Class scheduling — overlapping sessions hit `503 NO_SLOTS_AVAILABLE`. | Live classes fail to start at peak times with no prior warning. |
| 7 | DRM ETA | Docs state DRM assets **currently cannot be played** (no licence server). | Shipping `drm: true` produces DASH output with a null HLS manifest — unplayable content. |
| 8 | Pagination | Any library sync / reconciliation job over a large asset list. | Silent truncation of a sync job at an undocumented page size. |

## Follow-ups once answered

- Record the answers inline in this doc (dated), then write the implementation plan to
  `docs/migration/STREAMOS_V1_MIGRATION.md`.
- Log any resulting schema change (`ws_live_session` likely needs `stream_key`,
  `push_expires_at`, `recorded_asset_id`, plus a webhook-delivery idempotency store) in
  `docs/MIGRATION_QUERY_CHANGES.md` per the standing rule.
- Note: the existing `STREAMOS_ACCESS_KEY` / `STREAMOS_ACCESS_SECRET` / `STREAMOS_WEBHOOK_SECRET`
  vars are read directly off `process.env` and are in **neither `.env.example` nor
  `config/env.ts`**. The new vars must be added properly to both.
