# Admin Course — Exam Countdown Category

Mirrors the `examCountdownCategoryId` field already available on Admin Packages,
extending it to the Course CRUD.

## Field

| Field | Type | Required | Notes |
|---|---|---|---|
| `examCountdownCategoryId` | `ObjectId \| null` | No | References `ExamCountdownCategory`. Send `null` (or `""`) to clear. |

## Schema changes

- `src/models/course/Course.model.ts` — adds `examCountdownCategoryId` (Schema.Types.ObjectId, ref `ExamCountdownCategory`, default `null`).
- `src/admin/course/course.validation.ts` — adds nullable optional 24-hex string validator on the create schema (update reuses `.partial()`).

## Endpoints affected

All under `/api/v1/admin/courses` (Bearer auth required, as with the rest of admin):

### `GET /api/v1/admin/courses`
- Response now includes `examCountdownCategoryId` populated as `{ _id, name, colorHex }` on each course.

### `GET /api/v1/admin/courses/:id`
- Same populated shape on `data.course.examCountdownCategoryId`.

### `POST /api/v1/admin/courses`
- Accepts `examCountdownCategoryId` (24-hex ObjectId, optional).
- Stored as `null` when omitted, empty string, or the literal `"null"`.

```json
{
  "name": "SSC CGL 2026",
  "description": "...",
  "image": "https://...",
  "ordered": 1,
  "level": "advanced",
  "status": true,
  "examCountdownCategoryId": "66f0a1b2c3d4e5f600112233"
}
```

### `PATCH /api/v1/admin/courses/:id`
- Send `examCountdownCategoryId` to set it.
- Send `null` or `""` to clear.
- Omit the key entirely to leave it unchanged.

```json
{ "examCountdownCategoryId": "66f0a1b2c3d4e5f600112233" }
```

```json
{ "examCountdownCategoryId": null }
```

## Behavior notes

- Validation matches the package pattern: a 24-hex string OR `null`.
- Empty string and the literal string `"null"` (sent from multipart forms) are normalized to `null` before validation.
- No migration is required — existing documents without the field read as `null` via the schema default.
