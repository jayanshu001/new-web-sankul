# Large Report Exports (CSV / XLSX) — Backend Design

**Status:** implemented · **Date:** 2026-07-13
**Goal:** export lakhs of rows to CSV/XLSX without failing and without stressing the server.

---

## TL;DR

There are **two** export delivery mechanisms, sharing the **same** row builders:

| Path | Endpoint | How it responds | Use for |
|------|----------|-----------------|---------|
| **Synchronous** | `GET /admin/<report>/export/{csv,excel}` | builds the file in-request and streams it back as a download | small / medium result sets (instant download) |
| **Asynchronous** | `POST /admin/exports` → poll `GET /admin/exports/:jobId` | BullMQ worker builds off-request, uploads to Spaces, client polls for a signed URL | **large exports (lakhs of rows)** |

For lakhs-of-rows exports, use the **async** path. It is now **bounded-memory end-to-end** — the file is streamed straight from the database to Spaces and never fully materializes in RAM.

---

## Why the async path is safe at lakhs-scale

An export at scale has three failure modes. Here is how each is eliminated:

### 1. HTTP timeout (gateway 504)
The synchronous endpoint holds the HTTP connection open for the entire build. A multi-lakh export easily exceeds the load-balancer request timeout → **504**, work wasted.

**Solved:** the async path returns `202 { jobId }` immediately. The actual work runs in a **BullMQ worker** (`src/admin/exports/export.scheduler.ts`, queue `report-export`, concurrency 3). No client connection is held.

### 2. Database memory
Loading a whole filtered set at once would blow up memory.

**Solved (pre-existing):** every report reads rows in **keyset batches of 5,000** (`id DESC`, no deep `OFFSET`). Only one batch of DB rows is resident at a time. See each module's `iterate*ExportRows` generator.

### 3. Output / file memory  ← *this is what was just fixed*
Previously the builders finished by materializing the **entire file** in RAM (`Buffer.concat(...)` for XLSX, one giant CSV string) and the upload was a single `PutObject` (needs the full buffer + `ContentLength`). At 5–10 lakh rows × concurrency 3 this is a real OOM risk.

**Solved:** the output is now **streamed** — the report is written row-by-row into a stream that is *simultaneously* being multipart-uploaded to Spaces. Peak memory is one DB batch + one ~5 MB upload part, **flat regardless of row count**.

---

## Architecture (async path)

```
POST /admin/exports                  createExportJob() → ws_export_job row (status=pending)
      │                              enqueueExportJob(jobRef)  ── BullMQ "report-export"
      ▼
BullMQ worker  runExportJob(jobRef)
      │
      │  def.resolveSource(filters)          ← report's keyset row source  { headers, rowBatches }
      │        │                               (src/modules/admin-*/*.service.ts → *ExportSource)
      │        ▼
      │  streamReportToWritable(source, fmt, uploadBody)   ← src/utils/reportStream.ts
      │        │   CSV  → fast-csv format() piped into uploadBody
      │        │   XLSX → ExcelJS.stream.xlsx.WorkbookWriter({ stream: uploadBody })
      │        ▼
      │  createExportUpload(...)             ← src/utils/exportStorage.ts
      │        multipart Upload (@aws-sdk/lib-storage), Body = PassThrough, ~5 MB parts
      │        ▼
      │  Spaces (PRIVATE object)  admin/exports/<type>/<jobRef>.<ext>
      ▼
ws_export_job → status=ready, fileKey, rowCount, expiresAt
      │
      ▼
GET /admin/exports/:jobId → { status, progress, rowCount, downloadUrl (freshly signed) }
```

Nothing in that chain holds the whole file. The database batch feeds the formatter, the formatter feeds the upload, the upload flushes 5 MB parts to Spaces and discards them.

---

## Key files

| File | Responsibility |
|------|----------------|
| `src/utils/reportStream.ts` | **NEW.** `streamReportToWritable(source, format, out)` — writes a `{headers, rowBatches}` source into any `Writable` as CSV (fast-csv) or XLSX (`WorkbookWriter`), with backpressure. Returns the row count. Never buffers the whole file. |
| `src/utils/exportStorage.ts` | **`createExportUpload(key, contentType, fileName)`** — multipart streaming upload via `@aws-sdk/lib-storage`; returns `{ body: PassThrough, done }`. (`uploadExportObject` — the old single-`PutObject` buffer upload — is retained for the small referral report.) |
| `src/modules/admin-*/**.service.ts` | Each report exposes a **source factory** (`courseSubExportSource`, `ebookSubExportSource`, `tsSubExportSource`, `orderExportSource`, `liveSubExportSource`) returning `{ worksheetName, headers, rowBatches }`. Reuses the report's existing keyset iterator + column spec → **byte-identical output** to the sync endpoint. |
| `src/modules/export-job/export-job.registry.ts` | Maps each `type` → `resolveSource(filters)` (streamed reports) or `build(filters, fmt)` (referral, buffer path). |
| `src/modules/export-job/export-job.service.ts` | `runExportJob` — prefers the streamed path (`resolveSource` → `createExportUpload` → `streamReportToWritable`); falls back to the buffer path for referral. Persists `rowCount`. |
| `src/admin/exports/export.scheduler.ts` | BullMQ queue/worker (`report-export`), boot rehydrate, retention GC, graceful shutdown. Booted in `src/index.ts` via `initExportScheduler()`. |
| `src/admin/exports/exports.controller.ts` / `exports.routes.ts` | HTTP surface (`POST /`, `GET /:jobId`, `GET /:jobId/download`). |

### Why CSV/XLSX libraries are still used

The two libraries (`fast-csv`, `exceljs`) are **not** replaced by going async — the worker calls the **same** formatting code, just in *streaming mode*:
- **CSV** → `fast-csv`'s `format()` stream (RFC-4180 quoting; byte-identical to the sync `buildCsvFromRowBatches`).
- **XLSX** → `exceljs`'s `stream.xlsx.WorkbookWriter` (`useStyles:false`, `useSharedStrings:false`) — the worksheet model is flushed to the stream as rows are added, never kept resident.

The only thing that changed is the **sink**: instead of collecting the stream into a `Buffer`, we pipe it into a multipart upload.

---

## Registered report types

`POST /admin/exports` accepts `type` ∈:

| `type` | Report | Formats | Path |
|--------|--------|---------|------|
| `subscription` | Course/package subscriptions | csv, excel | streamed |
| `liveCourseSub` | Live-course subscriptions | csv, excel | streamed |
| `testSeriesSub` | Test-series subscriptions | csv, excel | streamed |
| `ebookSubscription` | Ebook subscriptions | csv, excel | streamed |
| `bookOrder` | Book orders | csv, excel | streamed |
| `referral` | Referral withdrawals | csv only | buffer (small, not keyset-paged) |

`filters` = the same filter object the report's list endpoint accepts (minus `page`/`limit`).

---

## Operational notes

- **Concurrency:** worker runs 3 jobs in parallel. Peak memory per job ≈ one 5 000-row DB batch + ~20 MB upload buffer (4 × 5 MB parts). Three jobs ≈ well under 100 MB of export-related memory even at 10 lakh rows.
- **Retention:** generated files are PRIVATE and GC'd after `EXPORT_RETENTION_MINUTES` (default 45) via a delayed BullMQ job. Download URLs are signed fresh on every poll (`EXPORT_SIGNED_URL_TTL_SECONDS`, default 15 min).
- **Retries:** BullMQ `attempts: 3`, exponential backoff. On terminal failure the row is flipped to `failed` with the error message.
- **Crash recovery:** on boot, jobs stuck in `processing` are re-enqueued (`rehydrateExportJobs`).
- **Ownership:** a job is owned by the admin who created it; only that admin (or a super_admin) can poll/download it.
- **Multipart requirement:** DigitalOcean Spaces supports S3 multipart upload. For files smaller than one part (5 MB) `lib-storage` transparently falls back to a single `PutObject`.

## "Export scheduler not initialised" — cause & fix

**Cause:** the BullMQ `Queue` was created only inside `initExportScheduler()`, which
runs **only when `WORKER_ENABLED` is true**. But `enqueueExportJob()` is invoked from
the HTTP handler `POST /admin/exports`. So:

- **Split deployment** — API process with `WORKER_ENABLED=false` never created the
  queue → every create-export request threw *"Export scheduler not initialised."*
- **Boot race** — the HTTP server starts listening before `startWorkers()` finishes;
  a request in that window hit a null queue.

**Fix:** `export.scheduler.ts → ensureProducer()`. `enqueueExportJob` now lazily creates
a **producer-only** `Queue` (+ its Redis connection) in whatever process it runs in, and
`initExportScheduler` reuses that same queue before attaching the **worker/consumer**.
The producer (enqueue) and consumer (worker) are now independent, so:

| Process | Has producer queue (enqueue) | Has worker (process jobs) |
|---------|------------------------------|---------------------------|
| HTTP API (`WORKER_ENABLED=false`) | ✅ lazily created on first enqueue | ❌ (not needed) |
| Worker (`HTTP_SERVER_ENABLED=false`) | ✅ (reused by init) | ✅ |
| Single process (both enabled) | ✅ | ✅ |

Requires the same `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` in every process (they
share one Redis). No API/response change.

## Verification

- `yarn typecheck` — green.
- Streaming writer exercised with 200,000 synthetic rows for both formats: correct row counts, correct RFC-4180 escaping (embedded commas/quotes), valid XLSX zip (`PK` magic). In production the sink drains to Spaces, so memory stays flat.
