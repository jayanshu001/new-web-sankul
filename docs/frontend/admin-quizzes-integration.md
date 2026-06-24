# Admin Quizzes (Exams) — Frontend Integration Guide

Base path: `/api/v1/admin/quizzes` — Bearer token required on every call.

> Response envelope for these endpoints is `{ success, data, ... }` (NOT the
> standard `success()` wrapper). Lists add a `pagination` block. Errors are
> `{ success:false, message }`, or `{ success:false, errors }` for Zod validation.

---

## Exam DTO (response shape)

```jsonc
{
  "_id": "300007",                 // string
  "title": "Class 3 Mock 1",
  "description": null,
  "type": "subject",               // "subject" | "daily"
  "isPaid": true,
  "categoryId": { "_id": "6", "name": "Indian Polity" },  // see note ▼
  "durationMinutes": 30,
  "questionCount": 10,
  "positiveMarks": 1,
  "negativeMarks": 0.25,
  "solutionPdfUrl": "https://…/1782281052706-solutionPdfUrl.pdf", // or null
  "solutionPdfName": "Test 151 - Class 3.pdf",                    // or null
  "startAt": "2026-07-01T00:00:00.000Z",
  "endAt":   "2026-07-01T14:40:00.000Z",
  "status": true,                  // BOOLEAN: true = published, false = draft
  "orderBy": 0,
  "createdAt": "…",
  "updatedAt": "…",
  "actualQuestionCount": 10        // GET /:id only
}
```

### ⚠ `categoryId` is polymorphic (matches legacy contract)
- **List + Get-by-id** → populated object `{ _id, name }`.
- **Create + Update + Status** responses → plain **string id** (`"6"`), unpopulated.

Handle both, e.g.:
```ts
const catId = typeof e.categoryId === "object" ? e.categoryId?._id : e.categoryId;
const catName = typeof e.categoryId === "object" ? e.categoryId?.name : undefined;
```

### ⚠ `status` is a boolean here
SQL stores status as a boolean (`true`=published). It is **not** the
`"published"/"draft"` string. Map for display; send a boolean on create/update.

---

## Endpoints

### List — `GET /quizzes`
Query params (all optional): `search`, `categoryId`, `type` (`subject|daily`),
`status` (`true|false` or `published|draft`), `isPaid` (`true|false`),
`page` (default 1), `limit` (default 20, max 100).

```jsonc
{ "success": true, "data": [ /* Exam */ ],
  "pagination": { "total": 226, "page": 1, "limit": 20, "totalPages": 12 } }
```
Search is DB-wide then paged → reset to `page=1` on a new search; drive the pager
from `pagination.total / totalPages`.

### Get — `GET /quizzes/:id`
`{ success, data: Exam + actualQuestionCount }`. `:id` is the integer id (e.g. `300007`).

### Create — `POST /quizzes`
### Update — `PUT /quizzes/:id`  (partial; only sent fields change)

Two content types are supported:

**A) With a PDF → `multipart/form-data`**
- File part field name **must be `solutionPdfUrl`** (PDF, ≤ 50 MB).
- All other fields are sent as form fields (strings — the server coerces numbers/booleans/dates).
- `solutionPdfName` is filled automatically from the uploaded file's name; you may override by sending it explicitly.

**B) Without a file → JSON** (`Content-Type: application/json`)
- Set `solutionPdfUrl` as a string to point at an existing URL, or `null`/`""` to clear it.

Body fields:

| Field | Type | Notes |
|---|---|---|
| `title` | string | **required** (create) |
| `categoryId` | string | **required** (create). Null/empty/invalid → `400 "categoryId is required."` |
| `durationMinutes` | int > 0 | **required** (create) |
| `positiveMarks` | number ≥ 0 | **required** (create) |
| `negativeMarks` | number | **required** (create) |
| `type` | `subject`/`daily` | default `subject`. (`mock`/`weekly` accepted but stored as `subject`.) |
| `questionCount` | int ≥ 0 | optional |
| `startAt`, `endAt` | date | **required when `type=daily`**; `endAt` must be after `startAt` |
| `solutionPdfUrl` | file \| string \| null | upload / set / clear |
| `solutionPdfName` | string | optional override of original filename |
| `isPaid` | boolean | optional |
| `status` | boolean | optional (true=published) |
| `sendPush` | boolean | optional |

Success: `201` (create) / `200` (update) `{ success, data: Exam }`.

### Delete — `DELETE /quizzes/:id`
`{ success, message: "Exam and related data deleted." }` — cascades questions,
options, results and result-details.

### Toggle status — `PATCH /quizzes/:id/status`
Body `{ "status": "published" }` (legacy enum string) **or** `{ "status": true }`
(boolean). Returns `{ success, data: Exam }`.

### Reorder — `POST /quizzes/reorder`
Body `{ "orders": [ { "id": "300007", "orderBy": 1 }, … ] }`.

---

## Error responses to handle

| Status | Body | When |
|---|---|---|
| 400 | `{ success:false, message:"Invalid exam id." }` | non-integer `:id` |
| 400 | `{ success:false, message:"categoryId is required." }` | create/update without a valid category |
| 400 | `{ success:false, message:"startAt and endAt are required for daily tests." }` | daily test missing window |
| 400 | `{ success:false, errors:[…] }` | Zod validation (field issues) |
| 404 | `{ success:false, message:"Exam not found." }` | unknown id |
| 409 | `{ success:false, message, conflict:{…} }` | a **published daily** test's window overlaps another — show `message`, optionally `conflict` |

---

## PDF upload — minimal example

```ts
const fd = new FormData();
fd.append("title", title);
fd.append("categoryId", categoryId);          // required
fd.append("durationMinutes", String(duration));
fd.append("positiveMarks", String(pos));
fd.append("negativeMarks", String(neg));
fd.append("type", type);                       // "subject" | "daily"
if (type === "daily") { fd.append("startAt", startISO); fd.append("endAt", endISO); }
if (pdfFile) fd.append("solutionPdfUrl", pdfFile);   // <-- field name matters
// do NOT set Content-Type manually; the browser adds the multipart boundary

await api.post("/admin/quizzes", fd);
```

To **clear** an existing PDF (JSON): `PUT /quizzes/:id` with `{ "solutionPdfUrl": null }`
(also nulls `solutionPdfName`, and deletes the old file from storage).

---

## Related endpoints recently aligned

- **Materials** `GET /admin/materials`, `GET /admin/materials/:id`: now return
  `materialCategory: { id, name } | null` alongside the string `materialCategoryId`,
  and `fileName` (original upload name) alongside the storage `file` URL.
- **Exam-countdown categories** `GET /admin/exam-countdowns/categories`: supports
  `search`, and is paginated when `page`/`limit` are sent (returns the same
  `pagination: { total, page, limit, totalPages }` block; full flat array when no
  paging params are sent). Field name is `pagination`, not `meta`.
