# StreamOS: Old Integration vs New API

Compiled 2026-09-01 from <https://streamos.in/docs> vs our code.
Blockers: `STREAMOS_V1_QUESTIONS.md`

**It's a different API on a different host, not a version upgrade.** Nothing in our current
integration survives unchanged.

`?` = unverified. No live API call was made — docs only.

---

## 1. Auth & transport

| | Old | New |
|---|---|---|
| Base URL | `streamapi.streamos.co/streamos` | `api.streamos.in/api/public/v1` |
| 2nd base | `streamapi.streamos.co` (for VOD meta) | none |
| Credentials | `accessKey`+`accessSecret` in body/query | `Authorization: Bearer sk_live_…` header |
| Keys per org | no limit | **1 active** (2nd → `409`) |
| Key rotation | n/a | revoke-then-create, auth gap between |
| Key secret | static in env | shown once at creation |
| Envelope | varies (`body.data ?? body`) | `{success, message, data, meta, error}` |

### Status codes

| Code | Old handling | New meaning | Action |
|---|---|---|---|
| 401 | unhandled → 502 | `INVALID_API_KEY` | add |
| 403 | "bad credentials" | `PERMISSION_DENIED` | **message now wrong** |
| 404 | "service unavailable" | `NOT_FOUND` | **message now wrong** |
| 422 | unhandled | `VALIDATION_ERROR` + field map | add |
| 429 | hardcoded "wait 30s" | `RATE_LIMITED` + `Retry-After` | use header |
| 502 | retried 3× | `TRANSCODE_QUEUE_FAILED` | not a transient blip |
| 503 | retried 3× | `NO_SLOTS_AVAILABLE` | **stop retrying** |

Rate limits: 120/min per key · `POST /livestreams` 10/min · `POST /videos` 20/min · `POST /videos/upload-url` 60/min.
Pagination: not documented `?`

---

## 2. Endpoints

| Our function | Old | New | Verdict |
|---|---|---|---|
| `createStream` | `POST /createStream` | `POST /livestreams/` | rewrite + split (§3) |
| `getStreamDetails` | `GET /streamDetails` | `GET /livestreams/{id}/` | rewrite, loses `isLive` |
| `endStream` | `DELETE /endStream` | `POST /livestreams/{id}/end/` | rewrite |
| `getUploadedVideoDetails` | `GET /uploadedVideoDetails` | `GET /assets/{id}/` | rewrite |
| `getVodStreamMeta` | `GET /get-vod-stream-meta` | `GET /assets/{id}/` | merges into above |
| `getOrgDetails` | `GET /orgDetails` | **none** | gone |
| `updateWebhook` | `POST /updateWebhook` | `POST /webhooks/` | rewrite |
| `enrichMp4Sizes` | HEAD each MP4 | sizes now in payload | delete |

New endpoints available:

`POST /livestreams/schedule/` · `POST /livestreams/{id}/start/` · `GET /livestreams/` ·
`GET /assets/` · `POST /videos/upload-url/` + `POST /videos/`
Webhook list/update/delete: unknown `?`

---

## 3. Live-stream lifecycle

| | Old | New |
|---|---|---|
| Stream id | `T_177…?txSecret=…` (id + token in one string) | `public_id` + separate `stream_key` |
| RTMP URL | we build it | returned complete, pre-signed |
| **Push expiry** | permanent | **24h** (`push_expires_at`) |
| **Liveness** | `isLive` boolean | **no LIVE status** — stays `READY_TO_STREAM` while streaming |
| Statuses | `SCHEDULED→CREATED→ENDED→READY` (ours) | `SCHEDULED→READY_TO_STREAM→ENDED` |
| Metadata | `metadata:{title}` | `customTags` (max 20 pairs) |
| Recording pointer | none | `recorded_asset_id` |
| Latency | none | `NORMAL` / `LOW` |
| Concurrency | not modelled | slots; `503` when exhausted (limit unknown `?`) |

**The provisioning break.** `provisionLiveSession` mints RTMP early so admins configure OBS ahead
of time; `startScheduledLiveSession` reuses it. With 24h expiry, a Monday-provisioned Friday class
has a dead URL.

Fix maps onto our existing routes:

| Route | Today | Should become |
|---|---|---|
| `POST /:id/provision` | `createStream` | `POST /livestreams/schedule/` (no RTMP yet) |
| `POST /:id/start` | reuse or create | `POST /livestreams/{id}/start/` (mints RTMP) |

Cost: **admins can no longer pre-configure OBS days in advance.** Ops workflow change.

---

## 4. Recordings

| | Old | New |
|---|---|---|
| Delivery | 1 webhook | **2 events**, minutes apart |
| Event 1 | — | `LIVESTREAM_RECORDING_READY` → `asset_id`, `transcoding:true` (not playable) |
| Event 2 | — | `VIDEO_TRANSCODING_COMPLETED` → `url`, `renditions[]`, `size_bytes`, `download_url` |
| Failure | none | `VIDEO_TRANSCODING_FAILED` — new, we have no failure path |
| Stream end | ours only | `LIVESTREAM_ENDED` |
| **Correlation** | `body.streamId` | `data.stream.stream_key` on the Video payload — *"so you can tie it back to the broadcast"*. NOTE: the **key**, not the `public_id` we store as `streamId`. `LIVESTREAM_RECORDING_READY` carries only `asset_id`. |
| Playable URL | `recordings[].path` per quality | one `video.url` master m3u8 |
| Per-quality | full ladder | `renditions[]` — "for inspection, not playback" |
| MP4 | `mp4Links[]` ladder | one `download_url`, one quality, **`.mkv` in their example** |
| File sizes | we HEAD each URL | supplied |
| Ack deadline | none | **10 seconds** |
| Retries | none | 6, exponential |
| Idempotency | not needed | **required** (`X-Streamos-Delivery`) |

**Two problems this creates:**

**(a) Our primary array loses its source.** `toPublicView` returns `recordings: jArr(row.mp4Recordings)`
— MP4 is primary in the client contract. There's no MP4 ladder any more. Options: map the single
`download_url` to a one-element array, promote HLS to primary (client-visible change), or ask
StreamOS for a ladder. Needs a decision.

**(b) 10s ack vs `enrichMp4Sizes`.** It runs HEAD requests inside the webhook handler. Late ack →
6 retries → duplicate `ws_video` rows from auto-promote. Resolved by deleting the function (sizes
now arrive in the payload).

---

## 5. Webhook auth

| | Old | New |
|---|---|---|
| Signing | none | HMAC-SHA256 over raw body |
| Our workaround | `?key=` + `x-webhook-secret` | not needed |
| Headers | none | `X-Streamos-Event`, `-Delivery`, `-Signature: t=…,v1=…` |
| Secret | our own env var | `signing_secret`, returned once |
| Replay defence | none | reject stale `t` |
| Unset secret | accepts + warns | should hard-fail |

`req.rawBody` is already stashed in `app.ts` for Razorpay — reuse it.

---

## 6. Playback & DRM

| | Old | New |
|---|---|---|
| Live HLS | `hlsURL` + `hls240pURL…hls1080pURL` | single `hls_url` |
| VOD HLS | `get-vod-stream-meta` | `video.hls_manifest_url` + `renditions[]` |
| DRM | DRM-HLS | `drm:true` → DASH, null HLS, **no licence server yet — unplayable** |
| URL security | public CDN URLs | same — public, no token, no expiry |
| Subtitles | none | `generate_subtitles`, `transcript_url`, `summary_url` |
| Download | derived | `download_url` + `download_quality` |

Set `drm:false` until their licence server ships.
Our `mediaToken` + `/client/media/resolve` gate stays the only protection — unchanged, still correct.

---

## 7. Gone with no replacement

| Lost | Used by | Consequence |
|---|---|---|
| `isLive` | client+admin live controllers, `client-media`, health check | "Live Now" badge, player state, 3-min preview gate — must derive locally |
| `orgDetails` | `/streamos/org`, 2 health checks | no backing API |
| Webhook readback | health check | can't verify registration `?` |
| Per-quality live HLS | `hlsUrls`, app quality picker | fall back to ABR |
| MP4 ladder | `recordings`, `mp4Url`, offline downloads | see §4a |
| Stream id in webhook | `updateByStreamId()` | Not lost — correlation moves to `stream_key` (own column). Only `LIVESTREAM_RECORDING_READY` is uncorrelatable, and it only stores a pointer. |

---

## 8. Files to change

| File | Lines | Change | Size |
|---|---|---|---|
| `admin/live/streamos.service.ts` | all 407 | full rewrite | L |
| `admin/live/live.controller.ts` | 965–1080 | webhook: HMAC, 2 events, idempotency | L |
| `admin/live/live.controller.ts` | 491, 546 | provision→schedule, start→start | M |
| `admin/live/live.controller.ts` | 839 | webhook registration | M |
| `admin/live/live.controller.ts` | 850–960 | health check: 3 of 5 checks lose source | M |
| `admin/live/live.controller.ts` | 740 | end stream | S |
| `admin/live/live.controller.ts` | 774–795 | uploaded video → assets | S |
| `admin/live/live.controller.ts` | 796–820 | org details — remove | S |
| `admin/live/live.controller.ts` | 37–52 | secret compare → HMAC; `?`-split dead | S |
| `admin/live/live.routes.ts` | 29–30 | repoint/remove 2 routes | S |
| `client/live/live.controller.ts` | 263 | `isLive` + recovery | M |
| `modules/client-media/client-media.service.ts` | 208 | live HLS at resolve | M |
| `modules/admin-live-course/…service.ts` | ~1760–1790 | `resolveVodMeta` + cache | M |
| `modules/admin-live/admin-live.service.ts` | 105 | `toPublicView` sourcing | M |
| `socket/camera-ingest.ts` | 206–221 | new rtmp_url + expiry | S |
| `scripts/backfill-live-recordings-…ts` | all | rebuild on `GET /assets/` | M |
| `admin/live-course/live-course.video.controller.ts` | 135+ | promotion URL shape | S |
| `prisma/schema.prisma` | LiveSession | +`stream_key`, `push_expires_at`, `recorded_asset_id` | S |
| *new* | — | webhook delivery-id store | S |
| `config/env.ts` + `.env.example` | — | 3 new vars | S |

Current `STREAMOS_ACCESS_KEY` / `_SECRET` / `_WEBHOOK_SECRET` are read straight off `process.env`
and are in **neither** `.env.example` **nor** `config/env.ts`. Replacements must go in both.

---

## 9. Rollout

Old sessions and stored recording URLs must keep resolving. Use a provider flag so existing
`ws_live_session` rows hit the old host while new ones use `api.streamos.in`.

Temporary or permanent depends on Q4 (sunset date) and Q2 (do old URLs survive their migration) —
both unanswered.

---

## 10. Limits of this analysis

- Zero live API calls. Documentation only.
- Diff is *new docs vs our code*, not *old docs vs new docs* — old-API features we never used are invisible.
- Docs read via fetch-and-summarise: won't see tabs, accordions, or code-sample switchers.
- Unconfirmed: webhook list/update/delete, folder schema, `fields` param, pagination, full livestream object.
- **Q1 CORRECTED:** an earlier draft of this doc claimed the recording payload carried no
  stream reference. It does — `data.stream.stream_key` on the Video payload. That claim came
  from reading the abbreviated `LIVESTREAM_RECORDING_READY` table in isolation. Correlation is
  solved; the code matches on `ws_live_session.stream_key`.

Next step: generate a key (`websankul.dev@gmail.com` → `/settings/api-keys`) and probe the live API.
One throwaway stream + one webhook registration converts every `?` into a fact.
