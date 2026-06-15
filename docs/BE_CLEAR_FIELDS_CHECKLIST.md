# Backend — "Clear field" / filter checklist (FE hand-off)

Response to the frontend team's five-item list. Each item below states its
**status**, what the API now accepts, and how the FE should call it.

Base: `/api/v1/admin`. All admin routes require the admin Bearer token.

| # | Item | Status |
|---|------|--------|
| 1 | Clear exam solution PDF (`solutionPdfUrl: null`) | ✅ **Implemented** |
| 2 | Filter exams by `status` (draft/scheduled/published/archived) | ✅ **Already worked** |
| 3 | Clear exam-category image (`image: null` / empty multipart) | ✅ **Implemented** |
| 4 | Clear goal image (empty multipart) | ✅ **Implemented** |
| 5 | Clear ebook PDFs (`demoUrl: null` / `bookUrl: null`) | ✅ **Already supported** |

---

## 1. Clear exam solution PDF — `PUT /exams/:id`

**Was:** `solutionPdfUrl` accepted only a string/file. A JSON `null` failed validation.
**Now:** accepts a URL (set), absence (unchanged), or **`null` / `""` (clear)**.

A clear translates to a `$unset` of `solutionPdfUrl` and best-effort deletes the
old S3 object.

```http
PUT /api/v1/admin/exams/:id
Content-Type: application/json

{ "solutionPdfUrl": null }
```

(Uploading a new PDF still works via multipart field `solutionPdfUrl`.)

---

## 2. Filter exams by status — `GET /exams?status=...`

**Status:** already worked — no change was needed. The FE note conflated this
with the *category* list (which uses `status=true|false`). For **exams**,
`status` is the enum and the list already filters on it.

```http
GET /api/v1/admin/exams?status=draft
GET /api/v1/admin/exams?status=scheduled
GET /api/v1/admin/exams?status=published
GET /api/v1/admin/exams?status=archived
```

Combinable with `search`, `categoryId`, `type`, `isPaid`, `page`, `limit`.
`Exam.status` stores one of `draft | scheduled | published | archived`.

---

## 3. Clear exam-category image — `PUT /exams/categories/:id`

> Note the path: exam categories live under **`/exams/categories/:id`**, not
> `/exam-categories/:id`.

**Was:** `image` accepted only a string/file; no clear path.
**Now:** accepts a URL (set), absence (unchanged), or **clear** via either:
- JSON `{ "image": null }`, or
- multipart with an **empty** `image` field.

A clear `$unset`s `image` and best-effort deletes the old S3 object.

```http
PUT /api/v1/admin/exams/categories/:id
Content-Type: application/json

{ "image": null }
```

---

## 4. Clear goal image — `PUT /goals/:id`

**Was:** the handler read the image only from an uploaded file, so there was no
way to clear it.
**Now:** multipart with an **empty** `image` field clears it (stored as `null`,
old S3 object deleted). Uploading a file replaces it; omitting the field leaves
it unchanged.

```http
PUT /api/v1/admin/goals/:id
Content-Type: multipart/form-data

image=            # empty value → clears
```

---

## 5. Clear ebook PDFs — `PUT /ebooks/:id`

**Status:** already supported (as the FE suspected). `demoUrl` and `bookUrl` are
nullable, and `""` is normalised to `null`. A `null` is persisted and the old S3
file is cleaned up.

```http
PUT /api/v1/admin/ebooks/:id
Content-Type: application/json

{ "demoUrl": null, "bookUrl": null }
```

Same applies to `image` / `thumbnail` / `demoFileName` / `bookFileName`.

---

## Summary for the FE

- Items **2** and **5** needed no backend change — call them as documented above.
- Items **1**, **3**, **4** are now implemented in this repo. Once deployed to
  `:4001`, the FE's existing payloads work.
- Convention across all clears: **JSON `null`** where the endpoint is JSON
  (exam, ebook), **empty multipart field** where the endpoint is multipart
  (goal; exam-category accepts either). Sending nothing leaves the field
  unchanged — only an explicit null/empty clears.

Backend files touched: `src/admin/exam/exam.validation.ts`,
`src/admin/exam/exam.controller.ts`, `src/admin/goal/goal.admin.controller.ts`,
`src/admin/goal/goal.admin.service.ts`.
