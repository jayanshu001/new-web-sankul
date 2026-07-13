# Admin Guide — Exporting Reports (CSV / Excel), Including Very Large Exports

**Audience:** Frontend (admin panel) integrators.
**Date:** 2026-07-13

This guide explains how to export report data as **CSV** or **Excel**, and — importantly — how to export **very large** reports (lakhs of rows) reliably. There are two ways to export; pick based on size.

---

## Two ways to export

### A. Instant download (synchronous) — for small/medium reports

Each report already has direct download endpoints:

```
GET /api/v1/admin/subscriptions/export/csv?<filters>
GET /api/v1/admin/subscriptions/export/excel?<filters>
```
(and the equivalent under each report: live-course, test-series, ebook, book orders, referral withdrawals CSV).

- The server builds the file **during the request** and returns it directly as a file download.
- **Best UX for small/medium data** — one click, file downloads immediately.
- ⚠️ **Not suitable for lakhs of rows.** A very large export can exceed the gateway timeout and fail with a 504. Use path B for big exports.

**Rule of thumb:** if the filtered result could be tens of thousands of rows or more, use path **B**.

---

### B. Background export job (asynchronous) — for large reports (lakhs) ✅ recommended for big data

Instead of waiting on one request, you **create a job**, then **poll** until the file is ready, then **download** from a signed URL. The server generates the file in the background, streamed straight to storage, so it never times out or runs out of memory — even at lakhs of rows.

#### Step 1 — Create the job

```http
POST /api/v1/admin/exports
Authorization: Bearer <token>
Content-Type: application/json

{
  "type": "subscription",       // report type (see table below)
  "format": "excel",            // "csv" | "excel"  (default "excel")
  "filters": {                  // same filters as the report's list screen (omit page/limit)
    "status": "active",
    "startDate": "2026-01-01",
    "endDate": "2026-03-31"
  }
}
```

**Response `202 Accepted`:**
```json
{ "jobId": "exp_9f2c…", "status": "pending" }
```

Keep the `jobId`.

#### Step 2 — Poll for status

```http
GET /api/v1/admin/exports/<jobId>
Authorization: Bearer <token>
```

**Response `200`:**
```json
{
  "jobId": "exp_9f2c…",
  "status": "processing",      // pending → processing → ready | failed
  "progress": 0.1,             // 0..1, for a progress bar
  "rowCount": null,            // number of rows once ready
  "downloadUrl": null,         // a signed URL once ready
  "fileName": null,
  "error": null,
  "expiresAt": null
}
```

Poll every **2–3 seconds** until `status` is `ready` or `failed`.

When ready:
```json
{
  "jobId": "exp_9f2c…",
  "status": "ready",
  "progress": 1,
  "rowCount": 482310,
  "downloadUrl": "https://…spaces…/admin/exports/…?signature=…",
  "fileName": "subscription-report-2026-07-13.xlsx",
  "expiresAt": "2026-07-13T09:45:00.000Z"
}
```

#### Step 3 — Download

Open / fetch the `downloadUrl` — it forces a download with the correct file name. The URL is short-lived (about 15 minutes); if it expires, just poll again (`GET /admin/exports/:jobId`) to get a freshly signed URL, or use:

```http
GET /api/v1/admin/exports/<jobId>/download    →  302 redirect to a fresh signed URL
```

---

## Report types & filters

| `type` | Report | Formats |
|--------|--------|---------|
| `subscription` | Course / package subscriptions | csv, excel |
| `liveCourseSub` | Live-course subscriptions | csv, excel |
| `testSeriesSub` | Test-series subscriptions | csv, excel |
| `ebookSubscription` | Ebook subscriptions | csv, excel |
| `bookOrder` | Book orders | csv, excel |
| `referral` | Referral withdrawals | **csv only** |

**`filters`** = exactly the same filter fields the report's on-screen list uses (date ranges, status, ids, search, etc.), **without** `page`/`limit` — an export always covers the *entire* filtered set. Whatever narrows the table narrows the export identically.

The file content (columns, order, values) is **identical** to the instant-download version — only the delivery differs.

---

## Recommended frontend UX

1. On the report screen, offer **Export CSV** / **Export Excel** buttons.
2. **Decide the path:**
   - Optionally read the current list's `pagination.total`. If it's small, you may use the **instant** endpoints (path A) for a one-click download.
   - Otherwise (or always, to be safe) use the **async job** (path B).
3. For async: after `POST /admin/exports`, show a small **"Preparing your export…"** toast/panel with a progress indicator driven by `progress`.
4. Poll every 2–3s. On `ready`, auto-trigger the download (or show a **Download** button with the file name and row count).
5. On `failed`, show `error` and a **Retry** action (create the job again with the same params).
6. Let the user keep working — they don't need to sit on the screen; the job runs server-side. You can re-poll a stored `jobId` if they navigate back.

### Minimal example

```js
async function exportReport(type, format, filters) {
  const { jobId } = await api.post("/admin/exports", { type, format, filters });

  // poll
  for (;;) {
    await sleep(2500);
    const job = await api.get(`/admin/exports/${jobId}`);
    updateProgress(job.progress);           // 0..1
    if (job.status === "ready") {
      window.location.href = job.downloadUrl; // triggers download
      return;
    }
    if (job.status === "failed") {
      showError(job.error || "Export failed");
      return;
    }
  }
}
```

---

## Things to know

- **Auth:** every endpoint requires the admin Bearer token.
- **Ownership:** you can only poll/download an export **you** created (super-admins can access any). A `403` means the job belongs to another admin.
- **Expiry:** ready files live ~45 minutes, then are deleted. After that a poll returns no `downloadUrl` (and `/download` gives `410 Gone`) — just create the export again.
- **Status codes on `/download`:** `409` = not ready yet / failed, `410` = expired, `404` = unknown job.
- **Large exports are safe:** the background path is built for lakhs of rows — it streams data to storage in bounded memory, so it won't time out or crash the server. Prefer it whenever the data set is large.
- **Referral withdrawals** support **CSV only**; requesting `excel` returns an error.
