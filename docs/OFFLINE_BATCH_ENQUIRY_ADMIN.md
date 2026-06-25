# Offline Batch Enquiry — Admin API

Listing (and delete) of submissions made through the client offline-batch **"Register"** form
(see `OFFLINE_BATCH_ENQUIRY_CLIENT.md`). These are read-only from the admin side — enquiries
are created only by customers.

> 🔒 **Auth (required):** All `/api/v1/admin/*` routes require a **Bearer token** with role
> `admin` or `super_admin` (enforced by the admin router). No per-route flag needed.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET`    | `/api/v1/admin/offline/batch-enquiries` | Paginated listing of batch enquiries. |
| `DELETE` | `/api/v1/admin/offline/batch-enquiries/:id` | Delete a single batch enquiry. |

---

## 1. `GET /admin/offline/batch-enquiries`

Newest first (`createdAt` descending). `batchId` is populated to `{ name, startAt }` and
`customerId` to `{ name, mobile, email }` (may be `null` for legacy rows; for new submissions
it is always set since the client endpoint requires auth).

**Query params**
| Param      | Type   | Default | Notes |
|------------|--------|---------|-------|
| `batchId`  | string (ObjectId) | — | Filter to one batch. Ignored if not a valid ObjectId. |
| `search`   | string | — | Case-insensitive substring match across `name`, `mobile`, `email`. |
| `fromDate` | ISO date string | — | Include enquiries with `createdAt >= fromDate`. |
| `toDate`   | ISO date string | — | Include enquiries with `createdAt <= toDate`. |
| `page`     | number | `1` | 1-based page number. |
| `limit`    | number | `20` | Page size. |

**Response 200**
```json
{
  "success": true,
  "data": [
    {
      "_id": "6a2c10f0...",
      "customerId": {
        "_id": "6a1f...",
        "name": "Shubham",
        "mobile": "+91 98765 43210",
        "email": "shubhamsuthar@gmail.com"
      },
      "name": "Shubham",
      "email": "shubhamsuthar@gmail.com",
      "mobile": "+91 98765 43210",
      "qualification": "other",
      "otherQualification": "Diploma in Civil Engineering",
      "batchId": {
        "_id": "6a2830a6856ab2f5a245583a",
        "name": "Vartman Vishesh March 2026",
        "startAt": "2026-03-01T03:30:00.000Z"
      },
      "createdAt": "2026-06-15T07:00:00.000Z",
      "updatedAt": "2026-06-15T07:00:00.000Z"
    }
  ],
  "pagination": { "total": 42, "page": 1, "limit": 20, "totalPages": 3 }
}
```

### Rendering the qualification column

`qualification` is one of `post_graduate | graduate | 10_plus_2 | other`. Render labels:

| Value          | Display |
|----------------|---------|
| `post_graduate`| Post Graduate |
| `graduate`     | Graduate |
| `10_plus_2`    | 10 + 2 or Equivalent |
| `other`        | Other — show `otherQualification` text alongside (e.g. `Other — Diploma in Civil Engineering`). |

`otherQualification` is `null` for every value except `other`.

---

## 2. `DELETE /admin/offline/batch-enquiries/:id`

**Response 200**
```json
{ "success": true, "message": "Batch enquiry deleted." }
```

| Status | Body | When |
|--------|------|------|
| `400` | `{ "success": false, "message": "Invalid id." }` | `:id` is not a valid ObjectId. |
| `404` | `{ "success": false, "message": "Batch enquiry not found." }` | No enquiry with that id. |
| `500` | `{ "success": false, "message": "..." }` | Server error. |

---

## Admin UI checklist

- [ ] Listing screen with columns: Name, Mobile, Email, Qualification (+ Other text), Batch, Submitted at.
- [ ] Filters: batch dropdown (`batchId`), free-text `search`, date range (`fromDate`/`toDate`).
- [ ] Pagination using `pagination.total` / `totalPages`.
- [ ] Row delete → `DELETE /admin/offline/batch-enquiries/:id`, then refresh the page.
- [ ] Map `qualification` enum → display labels per the table above.
