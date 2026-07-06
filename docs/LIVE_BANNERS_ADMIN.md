# Live Banners — Admin API

A simplified banner resource for the home/live area where the linked entity is **always a Live Course**. The admin form is just: image + live-course dropdown + orderBy (no `key` selector — it's implicit).

The live-course dropdown should be sourced from the existing endpoint:

```
GET /api/v1/admin/live-courses?limit=100
```

**Auth:** Bearer token + `admin` / `super_admin` role (mounted under `/api/v1/admin/cms`).

## Endpoints

| Method   | Path                                          | Description |
|----------|-----------------------------------------------|-------------|
| `GET`    | `/api/v1/admin/cms/live-banners`              | List all live banners (ordered by `orderBy` asc, live course populated). |
| `GET`    | `/api/v1/admin/cms/live-banners/:id`          | Get one live banner. |
| `POST`   | `/api/v1/admin/cms/live-banners`              | Create. `multipart/form-data` with `image` file. |
| `PUT`    | `/api/v1/admin/cms/live-banners/:id`          | Update. `multipart/form-data` (image optional on update). |
| `POST`   | `/api/v1/admin/cms/live-banners/reorder`      | Bulk reorder. |
| `DELETE` | `/api/v1/admin/cms/live-banners/:id`          | Delete. |

---

## Create / Update — request

Send as `multipart/form-data` (so the file upload works). Same flow as `/banners`.

| Field          | Type            | Required (create) | Notes |
|----------------|-----------------|-------------------|-------|
| `image`        | file            | yes               | PNG/JPG/WEBP. Uploaded to S3; the server stores the resulting URL on the document. |
| `liveCourseId` | string (ObjectId) | yes             | 24-char hex `_id` of a LiveCourse (selected from the dropdown). |
| `orderBy`      | number (int)    | no (default `0`)  | Sent as string in multipart — server coerces. |

On update, all fields are optional; omit `image` to keep the existing one.

### Validation errors (400)
Returned as Zod issues, e.g.:
```json
{
  "success": false,
  "errors": [
    { "code": "invalid_string", "path": ["liveCourseId"], "message": "keyId must be a valid ObjectId" }
  ]
}
```

---

## Response shape

`liveCourseId` is **populated** to the full LiveCourse document on list and get.

```json
{
  "success": true,
  "data": {
    "_id": "6724a1b0c5e2b40012ab34cd",
    "image": "https://cdn.example.com/live-banners/lawyer.jpg",
    "liveCourseId": {
      "_id": "68d3a1f0c5e2b40012ab34cd",
      "title": "Advanced Civil Law — Live",
      "thumbnail": "https://...",
      "...": "...other LiveCourse fields"
    },
    "orderBy": 1,
    "createdAt": "2026-05-18T10:00:00.000Z",
    "updatedAt": "2026-05-18T10:00:00.000Z"
  }
}
```

List endpoint returns `data: [...]`.

---

## Reorder — `POST /reorder`

**Body**
```json
{
  "orders": [
    { "id": "6724a1b0c5e2b40012ab34cd", "orderBy": 1 },
    { "id": "6724a1b0c5e2b40012ab34ce", "orderBy": 2 }
  ]
}
```

Invalid ids in the list are silently skipped. If nothing is valid: `400 { success: false, message: "No valid ids." }`.

**Response 200**
```json
{ "success": true, "message": "Live banner order updated." }
```

---

## How this differs from `/banners`
- No `key` field — the resource itself implies live course.
- No `keyRef` field — single `ref: "LiveCourse"` on the schema, no dynamic `refPath`.
- `liveCourseId` is required (regular banners' `keyId` is optional).
- Stored in a separate collection: `ws_live_banner_sliders`.

## Files touched
- Model: [src/models/system/LiveBannerSlider.model.ts](src/models/system/LiveBannerSlider.model.ts)
- Validators: [src/admin/cms/cms.validation.ts](src/admin/cms/cms.validation.ts) (`liveBannerCreateSchema`, `liveBannerUpdateSchema`)
- Controller: [src/admin/cms/cms.controller.ts](src/admin/cms/cms.controller.ts) (`listLiveBanners`, `getLiveBanner`, `createLiveBanner`, `updateLiveBanner`, `deleteLiveBanner`, `reorderLiveBanners`)
- Routes: [src/admin/cms/cms.routes.ts](src/admin/cms/cms.routes.ts)
