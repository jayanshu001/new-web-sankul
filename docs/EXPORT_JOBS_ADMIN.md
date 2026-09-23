# Async report exports — Admin API

Generic async export jobs so large report exports never hit the client / reverse-proxy
timeout. The worker generates the file off-request, stores it in Spaces (private), and
hands back a short-lived signed download URL. Same filters + same columns as the existing
sync `/export` endpoints — only the delivery differs.

All routes are under `/api/v1/admin/exports` and require the admin Bearer token. A job is
owned by the admin who created it (only they, or a super_admin, can poll/download it).

## 1. Create a job

`POST /admin/exports`

```jsonc
{
  "type": "subscription",   // subscription | liveCourseSub | testSeriesSub | ebookSubscription
  "format": "excel",        // "csv" | "excel"  (default "excel")
  "filters": { /* the same params the matching list endpoint accepts, minus page/limit */ }
}
```

Response `202`:
```json
{ "jobId": "exp_9f3c…", "status": "pending" }
```

- Unknown `type` → `422 { success:false, message, supportedTypes:[…] }`.
- Returns immediately; generation happens in the background worker.

### Supported types (v1) and their filters

| `type` | `filters` = params of | Formats |
|---|---|---|
| `subscription` | `GET /admin/subscriptions` (course+package merged; `courseId,packageId,promoterId,promocodeId,hasMaterial,orderMethod,paymentMethod,status,startFrom,startTo,endFrom,endTo,dateFrom,dateTo,search,sortBy,sortOrder,type`) | csv, excel |
| `liveCourseSub` | `GET /admin/live-courses/subscriptions` (`liveCourseId,customerId,status,paymentMethod,activationType,dateFrom,dateTo,startFrom,endTo,search,sortBy,sortOrder`) | csv, excel |
| `testSeriesSub` | `GET /admin/test-series/subscriptions` (`testSeriesId,customerId,status,paymentMethod,dateFrom,dateTo,search,sortBy,sortOrder`) | csv, excel |
| `ebookSubscription` | `GET /admin/ebooks/subscriptions/list` (`customerId,ebookId,status,paymentMethod,dateFrom,dateTo,search,sortBy,sortOrder`) | csv, excel |

`bookOrder` and `referral` are **not yet supported** (their sync exporters don't exist
yet) — they return `422 unsupported`. Send scope ids (e.g. `liveCourseId`, `testSeriesId`)
inside `filters` since there's no URL param on this generic route.

## 2. Poll status

`GET /admin/exports/:jobId`  (poll every ~3s; stop on `ready` or `failed`)

```jsonc
{
  "jobId": "exp_9f3c…",
  "status": "processing",       // pending | processing | ready | failed
  "progress": 0.1,              // 0..1 (coarse: pending 0 → processing 0.1 → ready 1)
  "rowCount": null,             // reserved (not populated in v1)
  "downloadUrl": null,          // signed URL when status=ready (freshly signed each poll)
  "fileName": "subscription-report-2026-07-09.xlsx",
  "error": null,                // human-readable when status=failed
  "expiresAt": "2026-07-09T12:30:00Z"  // when the file / link stops being valid
}
```

- When `status = ready`, `downloadUrl` is a short-lived signed link — just navigate to it.
  It re-signs on every poll, so a slightly stale poll response still yields a fresh link.
- After `expiresAt` the file is GC'd; `downloadUrl` becomes `null` (re-create the job).

## 3. Download (alternative to `downloadUrl`)

`GET /admin/exports/:jobId/download` → `302` redirect to a fresh signed URL.
`409` if not ready / `410` if expired / `404` if unknown / `403` if not the owner.

## Notes

- Output is byte-identical to the sync `/export/{csv,excel}` endpoints (same filter
  parser, row builder, and column spec are reused server-side).
- Retention window is configurable (`EXPORT_RETENTION_MINUTES`, default 45).
- v1 reuses the existing capped row-builders (100k rows/report); generation is off-request
  so nothing times out, but it isn't yet keyset-streamed — that's a per-report follow-up.
