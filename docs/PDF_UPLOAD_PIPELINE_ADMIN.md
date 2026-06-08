# Admin PDF Upload — BullMQ Queue + Live Socket.io Progress

The Edit-Ebook screen uploads one PDF and attaches it to the eBook's `bookUrl`
(or `demoUrl`). The PDF is processed by a **BullMQ queue with `concurrency: 1`**
— uploaded to Spaces off the request path — while the admin watches it march
`queued → in_progress → completed` (or `failed`) **live over Socket.io**.

A persisted `PdfUploadJob` row is the **source of truth** the admin UI renders;
BullMQ is just the runner. Each upload gets a unique `batchId` that doubles as
the Socket.io room key.

---

## Flow

```
POST /api/v1/admin/ebooks/:ebookId/pdf   (multipart: file + optional target)
        │  multer → temp disk
        ▼
PdfUploadJob.create({ status:"queued", batchId })  →  enqueue
        ▼
BullMQ queue "pdf-upload"  →  Worker (concurrency: 1)
        ▼
processPdf(job):
   ├─ status "in_progress"        ──► emit pdf_job_update
   ├─ stream temp file → Spaces   ──► emit
   ├─ read OLD ebook url, then set ebook.bookUrl/demoUrl ──► emit (status "completed")
   ├─ unlink temp file
   ├─ delete the REPLACED old PDF from Spaces (if changed & in our bucket)
   └─ emit pdf_batch_done
        ▼
Socket.io  namespace /admin/pdf-uploads  ·  room pdf_batch:<batchId>
        ▼
Admin client renders live progress
```

---

## Files

| File | Role |
|------|------|
| [`PdfUploadJob.model.ts`](../src/models/system/PdfUploadJob.model.ts) | The job row — `batchId`, `ebookId`, `targetField`, `status`, `progress`, `fileUrl`, `failureReason`. UI source of truth. |
| [`pdfUpload.multer.ts`](../src/admin/pdfUpload/pdfUpload.multer.ts) | Stages the incoming PDF to temp disk (not memory/Spaces). PDF-only, ≤500 MB. |
| [`pdfUpload.controller.ts`](../src/admin/pdfUpload/pdfUpload.controller.ts) | `uploadEbookPdf` (stage + enqueue), `getPdfUploadBatch` (snapshot). |
| [`pdfUpload.scheduler.ts`](../src/admin/pdfUpload/pdfUpload.scheduler.ts) | BullMQ queue + worker (concurrency 1), `processPdf`, retries, boot rehydrate, shutdown. |
| [`pdf-progress.socket.ts`](../src/socket/pdf-progress.socket.ts) | Admin Socket.io **namespace** + emit helpers. |
| [`ebook.routes.ts`](../src/admin/ebook/ebook.routes.ts) | Mounts the upload + snapshot routes. |

---

## HTTP API

Requires an **admin** Bearer token (`admin | super_admin`).

### `POST /api/v1/admin/ebooks/:ebookId/pdf` — upload

`multipart/form-data`:

| Field | Type | Notes |
|-------|------|-------|
| `file` | File | One PDF (`application/pdf`, ≤500 MB). |
| `target` | string | Optional. `"bookUrl"` (default) or `"demoUrl"`. |

**201** → `{ batchId, socket: { namespace, room, joinEvent }, job: {...} }`

### `GET /api/v1/admin/ebooks/pdf-jobs/:batchId` — status snapshot

For (re)connect. Returns `{ total, completed, failed, inProgress, queued, done, jobs: [...] }`.

---

## Persisted status on the ebook (list/detail)

The per-session socket `batchId` can't be queried by the ebooks list, so the
**latest status is also written onto the ebook document** and returned by
`GET /admin/ebooks` (list) and `GET /admin/ebooks/:id` (detail). Four fields per
ebook:

| Field | Values |
|-------|--------|
| `bookUploadStatus` / `demoUploadStatus` | `"none" \| "queued" \| "processing" \| "completed" \| "failed"` |
| `bookUploadProgress` / `demoUploadProgress` | `0`–`100` |

`"none"` = no PDF in that slot. `"completed"` = PDF attached & ready
(`bookUrl`/`demoUrl` set). The pipeline writes these at each transition (job
`in_progress` is stored as the canonical **`processing`**):

| Pipeline event | Written on the ebook (slot = book/demo) |
|----------------|------------------------------------------|
| job queued | `{slot}UploadStatus="queued"`, `{slot}UploadProgress=0` |
| job in progress | `{slot}UploadStatus="processing"`, `{slot}UploadProgress=0–100` |
| job completed | `{slot}UploadStatus="completed"`, `{slot}UploadProgress=100`, + `bookUrl`/`demoUrl` set in the same write |
| job failed (after retries) | `{slot}UploadStatus="failed"` (the existing `bookUrl`/`demoUrl` is left intact) |

Each write invalidates the ebook list + detail caches, so the list (which polls
every 5s while anything is `queued`/`processing`) settles on its own.
Implemented by `setEbookUploadStatus()` in `ebook.service.ts`; backfill for
pre-existing ebooks: `migrations/2026-ebook-backfill-upload-status.ts`.

Example list item:

```json
{
  "_id": "6a195ba059f7f485f5838c2d",
  "name": "Indian Culture | Toppers Notes",
  "bookUrl": "https://.../book.pdf",
  "bookUploadStatus": "completed",
  "bookUploadProgress": 100,
  "demoUrl": null,
  "demoUploadStatus": "none",
  "demoUploadProgress": 0
}
```

---

## Live progress (Socket.io)

Progress is a **namespace** (`/admin/pdf-uploads`) on the **shared** Socket.io
server created by `initLiveChatSocket()` — not a second server (two on the same
HTTP server + path would collide). It authenticates **admin** tokens only; the
shared Redis adapter fans emits out across pods.

```js
const socket = ioClient("https://api.websankul.com/admin/pdf-uploads", {
  auth: { token: ADMIN_ACCESS_TOKEN },
});
socket.emit("join_pdf_batch", { batchId });   // batchId from the POST response
socket.on("pdf_job_update", (u) => { /* u.status, u.progress, u.fileUrl */ });
socket.on("pdf_batch_done", (s) => { /* upload finished */ });
```

| Event | Direction | Payload |
|-------|-----------|---------|
| `join_pdf_batch` / `leave_pdf_batch` | client → server | `{ batchId }` |
| `pdf_job_update` | server → room | `{ batchId, jobId, index, fileName, ebookId, status, progress, fileUrl, failureReason }` |
| `pdf_batch_done` | server → room | `{ batchId, total, completed, failed }` |

`pdf_job_update` fires at every state change: `in_progress` (5%), after the
Spaces upload (80%), and `completed` (100%) — or `failed` once retries are
exhausted.

---

## Guarantees

- **Off the request path** — the HTTP request returns immediately; the upload runs in the worker.
- **Retries** — 3 attempts, exponential backoff; row flips to `failed` only after all attempts exhausted.
- **Crash recovery** — on boot, jobs left `queued`/`in_progress` are re-enqueued (deterministic `jobId` = idempotent), so a restart mid-upload resumes.
- **Graceful shutdown** — worker `close()` waits for the active upload to finish.
- **Temp cleanup** — staged file removed after upload; rejected requests clean up immediately.

---

## Storage cleanup (no orphaned files)

Replaced and deleted files are removed from Spaces automatically — the frontend
does nothing extra. All three paths share one rule: **own-bucket URLs only**
(external links are never touched), **best-effort** (errors swallowed, never
fail the request), and the delete runs **after** the DB write succeeds.

| Action | What's cleaned | Where |
|--------|----------------|-------|
| Queue PDF upload (`POST /ebooks/:id/pdf`) | the replaced `bookUrl`/`demoUrl`, *after* the new file attaches (only if it changed). A failed/retried upload never touches the existing file. | `processPdf()` in `pdfUpload.scheduler.ts` |
| Sync ebook update (`PUT /ebooks/:id`) | any replaced `image` / `thumbnail` / `demoUrl` / `bookUrl` whose field was in the payload and changed. | `updateEbook()` in `ebook.service.ts` |
| Ebook delete (`DELETE /ebooks/:id`) | all of the ebook's `image` / `thumbnail` / `demoUrl` / `bookUrl`, *after* the delete transaction commits. | `deleteEbook()` in `ebook.service.ts` |

Shared helper: `isOwnBucketUrl(url)` + `deleteFromS3FileUrl(url)`, both exported
from [`middlewares/upload.ts`](../src/middlewares/upload.ts).

---

## Extending

Per-PDF work is one function — `processPdf()` in
[`pdfUpload.scheduler.ts`](../src/admin/pdfUpload/pdfUpload.scheduler.ts).
Add transforms (watermark, thumbnail, page-count) there with extra
`setProgress(n)` calls so new stages show live.

## Config

| Env | Default | Purpose |
|-----|---------|---------|
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | `localhost` / `6380` / – | BullMQ connection. |
| `DO_BUCKET` / `DO_ENDPOINT` / `DO_*` | – | Spaces upload. |
