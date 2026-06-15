# Offline Batch Enquiry — Client API

The offline-batch **"Register"** form. A logged-in customer fills name / email / number /
qualification (and a free-text "Other qualification" when they pick **Other**), tied to a
specific offline batch. Each submission is stored and later shown to admins as a listing.

> 🔒 **Auth (required):** This endpoint requires a **Bearer token** (authenticated `customer`).
> Unlike the older `/offline/enquiry` (best-effort auth), this route rejects anonymous calls
> with `401`. The submission is always recorded against the logged-in customer (`customerId`).

## Endpoint

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/client/offline/batch-enquiry` | Submit the offline-batch Register form for a batch. |

---

## `POST /offline/batch-enquiry`

**Headers**
```
Authorization: Bearer <customer access token>
Content-Type: application/json
```

**Request body**
| Field                | Type   | Required | Notes |
|----------------------|--------|----------|-------|
| `name`               | string | ✅ | 1–255 chars. |
| `email`              | string | ✅ | Valid email, ≤255 chars. |
| `mobile`             | string | ✅ | 6–20 chars. (The "Number" field, e.g. `+91 98765 43210`.) |
| `qualification`      | enum   | ✅ | One of: `post_graduate`, `graduate`, `10_plus_2`, `other`. |
| `otherQualification` | string | conditional | **Required only when** `qualification = "other"`. 1–255 chars. Ignored (stored as `null`) for any other value. |
| `batchId`            | string (ObjectId) | ✅ | The offline batch this enquiry is for. Must exist. |

### Qualification dropdown mapping

The form dropdown maps to these enum values:

| Dropdown label (UI) | Send as `qualification` |
|---------------------|-------------------------|
| Post Graduate       | `post_graduate` |
| Graduate            | `graduate` |
| 10 + 2 or Equivalent| `10_plus_2` |
| Other               | `other` + `otherQualification` free text |

> When the user selects **Other**, show the "Enter Qualification" text field and send its
> value as `otherQualification`. For the other three options, do **not** send
> `otherQualification`.

**Example — standard qualification**
```json
{
  "name": "Shubham",
  "email": "shubhamsuthar@gmail.com",
  "mobile": "+91 98765 43210",
  "qualification": "post_graduate",
  "batchId": "6a2830a6856ab2f5a245583a"
}
```

**Example — "Other"**
```json
{
  "name": "Shubham",
  "email": "shubhamsuthar@gmail.com",
  "mobile": "+91 98765 43210",
  "qualification": "other",
  "otherQualification": "Diploma in Civil Engineering",
  "batchId": "6a2830a6856ab2f5a245583a"
}
```

**Response 201**
```json
{
  "success": true,
  "data": {
    "_id": "6a2c10f0...",
    "customerId": "6a1f...",
    "name": "Shubham",
    "email": "shubhamsuthar@gmail.com",
    "mobile": "+91 98765 43210",
    "qualification": "post_graduate",
    "otherQualification": null,
    "batchId": "6a2830a6856ab2f5a245583a",
    "createdAt": "2026-06-15T07:00:00.000Z",
    "updatedAt": "2026-06-15T07:00:00.000Z"
  }
}
```

On success show the **"Registrations Successful"** confirmation sheet.

### Errors

| Status | Body | When |
|--------|------|------|
| `400` | `{ "success": false, "errors": [ ...zod issues ] }` | Validation failed (bad email, missing field, missing `otherQualification` when `other`, invalid `batchId` format). |
| `401` | `{ "success": false, "message": "Unauthorized." }` | Missing/invalid Bearer token. |
| `404` | `{ "success": false, "message": "Batch not found." }` | `batchId` does not match an existing batch. |
| `500` | `{ "success": false, "message": "..." }` | Server error. |

**Validation-error example (`other` without text)**
```json
{
  "success": false,
  "errors": [
    {
      "path": ["otherQualification"],
      "message": "otherQualification is required when qualification is 'other'."
    }
  ]
}
```

---

## FE checklist

- [ ] Gate the form behind login — the user must have a valid customer Bearer token.
- [ ] Map dropdown labels → enum values per the table above.
- [ ] Show the "Enter Qualification" field only when **Other** is selected, and require it.
- [ ] Send `batchId` of the currently-viewed offline batch.
- [ ] On `201`, show the "Registrations Successful" sheet.
- [ ] Surface `errors[].message` inline against `errors[].path` for `400`s.
