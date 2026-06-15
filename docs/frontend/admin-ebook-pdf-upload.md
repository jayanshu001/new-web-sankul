# Admin Panel — Ebook PDF Upload with Live Progress

Frontend guide for the **Edit-Ebook** screen's **Book PDF** / **Demo PDF**
fields. Instead of uploading the PDF inline with the form, the file is sent to a
dedicated endpoint that processes it on a background queue and streams
`queued → in_progress → completed` progress over Socket.io. The admin sees a
live progress bar; the old PDF (if any) is removed from storage automatically.

> Backend reference: [`PDF_UPLOAD_PIPELINE_ADMIN.md`](../PDF_UPLOAD_PIPELINE_ADMIN.md)

---

## 1. The flow (what the UI does)

```
1. User picks a PDF in the "Book PDF" (or "Demo PDF") slot.
2. POST the file → get back a `batchId` + the socket room info.
3. Open the Socket.io admin namespace, join the room with `batchId`.
4. Render the progress bar from `pdf_job_update` events (0 → 100).
5. On `status: "completed"` → show the file as uploaded (use `fileUrl`).
   On `status: "failed"`  → show `failureReason`, let the user retry.
6. (Optional) On page reload while an upload is in flight, call the snapshot
   endpoint with the stored `batchId` to re-render current state.
```

The PDF upload is **decoupled from the "Update Ebook" submit** — the file lands
on the ebook (`bookUrl`/`demoUrl`) as soon as the job completes. The rest of the
form (name, link, order, status, …) still saves via the normal
`PUT /admin/ebooks/:id`.

> **Two ways to show status.** While the admin is *on the edit screen*, the
> Socket.io stream below gives byte-level live progress for that upload. For the
> **ebooks list** (and any admin, after a refresh), the status is also persisted
> on the ebook document and returned by the list/detail endpoints — see
> [§1b](#1b-persisted-status-on-the-ebook-list). The list reads those fields and
> auto-polls; you don't need the socket there.

---

## 1b. Persisted status on the ebook (list)

`GET /admin/ebooks` and `GET /admin/ebooks/:id` return four extra fields per
ebook so the list can show a badge that survives refresh and is visible to any
admin:

| Field | Values |
|-------|--------|
| `bookUploadStatus` / `demoUploadStatus` | `"none" \| "queued" \| "processing" \| "completed" \| "failed"` |
| `bookUploadProgress` / `demoUploadProgress` | `0`–`100` |

- `"none"` = no PDF in that slot. `"completed"` = attached & ready
  (`bookUrl`/`demoUrl` set).
- Mid-flight example: `{ "bookUploadStatus": "processing", "bookUploadProgress": 60, "demoUploadStatus": "none" }`.
- The backend stores `"processing"` (the canonical value). The original socket
  event uses `"in_progress"`; your parser already maps `in_progress → processing`,
  so both work.
- Backward-compatible: older ebooks may omit these fields — treat
  "URL present, status absent" as completed (the FE already does).

No new endpoints — these ride along on the existing list/detail responses.

---

## 2. Endpoints

All require the admin Bearer token (roles `admin | super_admin`).
Base URL example: `http://localhost:4001/api/v1`

### 2.1 Upload a PDF — `POST /admin/ebooks/:ebookId/pdf`

`multipart/form-data`:

| Field | Required | Notes |
|-------|----------|-------|
| `file` | yes | One PDF. `application/pdf`, ≤ 500 MB. |
| `target` | no | `"bookUrl"` (default) or `"demoUrl"`. |

**Response `201`:**

```json
{
  "success": true,
  "code": 201,
  "message": "PDF upload queued.",
  "data": {
    "batchId": "0f2c8e1a-....-uuid",
    "socket": {
      "namespace": "/admin/pdf-uploads",
      "room": "pdf_batch:0f2c8e1a-....-uuid",
      "joinEvent": "join_pdf_batch"
    },
    "job": {
      "jobId": "665f0a1b2c3d4e5f60718293",
      "index": 0,
      "fileName": "indian_culture_notes.pdf",
      "ebookId": "6a195ba059f7f485f5838c2d",
      "target": "bookUrl",
      "status": "queued",
      "progress": 0
    }
  }
}
```

Store `data.batchId` — you need it to join the socket room (and for the snapshot
on reload).

**Error responses** (envelope `{ success:false, code, message }`):
`401` unauthorized · `400` invalid ebookId · `422` no file / bad `target` /
non-PDF · `404` ebook not found.

### 2.2 Status snapshot — `GET /admin/ebooks/pdf-jobs/:batchId`

Use on page reload / reconnect to render current state before live events
resume.

```json
{
  "success": true,
  "data": {
    "batchId": "0f2c8e1a-....-uuid",
    "total": 1, "completed": 1, "failed": 0, "inProgress": 0, "queued": 0,
    "done": true,
    "jobs": [
      {
        "jobId": "665f0a1b2c3d4e5f60718293",
        "index": 0,
        "fileName": "indian_culture_notes.pdf",
        "ebookId": "6a195ba059f7f485f5838c2d",
        "status": "completed",
        "progress": 100,
        "fileUrl": "https://<bucket>.<region>.digitaloceanspaces.com/admin/ebooks/...pdf",
        "failureReason": null,
        "startedAt": "2026-06-08T10:00:01.000Z",
        "finishedAt": "2026-06-08T10:00:04.000Z"
      }
    ]
  }
}
```

---

## 3. Socket.io

- **URL / namespace:** connect to `<API_ORIGIN>/admin/pdf-uploads`
  (e.g. `http://localhost:4001/admin/pdf-uploads`).
- **Path:** default `/socket.io` (don't override).
- **Auth:** pass the admin access token in the handshake `auth.token`. Only
  admin tokens are accepted; a customer/expired token is rejected at connect.
- **Transports:** `["websocket", "polling"]`.

### Client → server

| Event | Payload | When |
|-------|---------|------|
| `join_pdf_batch` | `{ batchId }` | After connect, with the `batchId` from the POST. |
| `leave_pdf_batch` | `{ batchId }` | When the user leaves the screen (optional). |

### Server → client

| Event | Payload |
|-------|---------|
| `joined_pdf_batch` | `{ batchId }` — ack that you're in the room. |
| `pdf_job_update` | `{ batchId, jobId, index, fileName, ebookId, status, progress, fileUrl, failureReason }` |
| `pdf_batch_done` | `{ batchId, total, completed, failed }` — upload finished. |
| `error` | `{ message }` — e.g. bad `batchId`. |

`pdf_job_update` fires at every state change:
- `status:"in_progress", progress:5` — started
- `progress:80` — file uploaded to storage
- `status:"completed", progress:100, fileUrl:"…"` — done
- `status:"failed", failureReason:"…"` — failed (after retries)

`status` values: `"queued" | "in_progress" | "completed" | "failed"`.

---

## 4. React example

```tsx
import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import axios from "axios";

const API_ORIGIN = "http://localhost:4001";
const API = `${API_ORIGIN}/api/v1`;

type JobStatus = "queued" | "in_progress" | "completed" | "failed";
interface JobUpdate {
  batchId: string;
  jobId: string;
  status: JobStatus;
  progress: number;
  fileName: string;
  fileUrl: string | null;
  failureReason: string | null;
}

export function useEbookPdfUpload(ebookId: string, token: string) {
  const [status, setStatus] = useState<JobStatus | "idle">("idle");
  const [progress, setProgress] = useState(0);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  // Open the admin namespace once, join the room for a given batchId.
  const watch = (batchId: string) => {
    const socket = io(`${API_ORIGIN}/admin/pdf-uploads`, {
      auth: { token },
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;

    socket.on("connect", () => socket.emit("join_pdf_batch", { batchId }));

    socket.on("pdf_job_update", (u: JobUpdate) => {
      if (u.batchId !== batchId) return;
      setStatus(u.status);
      setProgress(u.progress);
      if (u.fileUrl) setFileUrl(u.fileUrl);
      if (u.status === "failed") setError(u.failureReason ?? "Upload failed.");
    });

    socket.on("pdf_batch_done", () => socket.disconnect());
    socket.on("connect_error", (e) => setError(e.message));
  };

  // Upload one PDF; returns the batchId.
  const upload = async (file: File, target: "bookUrl" | "demoUrl" = "bookUrl") => {
    setError(null);
    setStatus("queued");
    setProgress(0);
    setFileUrl(null);

    const form = new FormData();
    form.append("file", file);
    form.append("target", target);

    const { data } = await axios.post(
      `${API}/admin/ebooks/${ebookId}/pdf`,
      form,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const batchId: string = data.data.batchId;
    watch(batchId);
    return batchId;
  };

  // Re-render current state after a page reload (pass a stored batchId).
  const resume = async (batchId: string) => {
    const { data } = await axios.get(
      `${API}/admin/ebooks/pdf-jobs/${batchId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const job = data.data.jobs[0];
    if (!job) return;
    setStatus(job.status);
    setProgress(job.progress);
    setFileUrl(job.fileUrl);
    if (job.status === "failed") setError(job.failureReason);
    if (job.status !== "completed" && job.status !== "failed") watch(batchId);
  };

  useEffect(() => () => socketRef.current?.disconnect(), []);

  return { status, progress, fileUrl, error, upload, resume };
}
```

UI sketch for the Book PDF slot:

```tsx
const { status, progress, fileUrl, error, upload } = useEbookPdfUpload(ebookId, token);

<label>Book PDF</label>
<input type="file" accept="application/pdf"
  onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "bookUrl")} />

{status === "in_progress" && <ProgressBar value={progress} />}
{status === "completed" && <a href={fileUrl!} target="_blank">View uploaded PDF</a>}
{status === "failed" && <span className="error">{error}</span>}
```

---

## 5. UX notes

- **Two slots, one endpoint.** Book PDF → `target:"bookUrl"`, Demo PDF →
  `target:"demoUrl"`. Each upload is independent (its own `batchId`).
- **Decoupled from "Update Ebook".** The PDF attaches itself on completion; you
  don't need to include it in the `PUT /admin/ebooks/:id` body. The other fields
  still save through that PUT as before.
- **Old file is auto-removed.** On a re-upload the backend deletes the previous
  PDF from storage after the new one attaches — the frontend does nothing extra.
  (See "Storage cleanup" below — this also covers the normal ebook update and
  delete.)
- **Replace during in-progress.** Disable the file input (or show a spinner)
  while `status === "in_progress"` to avoid a second upload racing the first.
- **Large files.** Limit is 500 MB. The HTTP POST returns quickly (the heavy
  work runs on the queue), so don't gate the UI on the POST — gate it on the
  socket events.
- **Reconnect.** Persist `batchId` (e.g. in component state / sessionStorage)
  so a reload can call `resume(batchId)`.

---

## 6. Storage cleanup — nothing extra to do on the frontend

The backend removes orphaned files automatically across **all** ebook flows, so
you never need a separate "delete old file" call:

| Frontend action | What the backend cleans up |
|-----------------|----------------------------|
| Re-upload a Book/Demo PDF (`POST /ebooks/:id/pdf`) | the PDF it replaced (`bookUrl`/`demoUrl`). |
| Save the Edit-Ebook form with a new image / thumbnail / demo / book file (`PUT /ebooks/:id`) | each replaced file for the fields you sent. |
| Delete an ebook (`DELETE /ebooks/:id`) | all of its files — image, thumbnail, demo PDF, book PDF. |

Notes:
- Cleanup is **best-effort** and runs after the DB write succeeds — it never
  fails your request. A `200`/`201` means the operation worked even if a stale
  file lingers.
- Only files stored in our own bucket are removed. If a field holds an
  **external URL** (e.g. a `link` to another host), it is left untouched.
- For the normal form save, just send the changed file fields as you already do
  in the multipart `PUT /ebooks/:id`; the old ones are cleaned up server-side.

---

## 7. Quick reference

| | |
|---|---|
| Upload | `POST /api/v1/admin/ebooks/:ebookId/pdf` (multipart `file`, optional `target`) |
| Snapshot | `GET /api/v1/admin/ebooks/pdf-jobs/:batchId` |
| Socket | `<API_ORIGIN>/admin/pdf-uploads`, auth `{ token }` |
| Join | emit `join_pdf_batch { batchId }` |
| Listen | `pdf_job_update`, `pdf_batch_done` |
| Status values | `queued`, `in_progress`, `completed`, `failed` |
