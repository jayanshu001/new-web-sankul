# StreamOS v1 API — Open Questions for the StreamOS Team (2026-09-01)

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
