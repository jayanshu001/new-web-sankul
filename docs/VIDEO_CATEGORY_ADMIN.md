# Video Categories (Admin) — API Reference

Base path: `/api/v1/admin/video-categories`

All endpoints require an authenticated admin token.

```
Authorization: Bearer <admin-token>
```

## Breaking change

`childCategoryId` (single `ObjectId`) has been replaced with **`childCategoryIds` (array of `ObjectId`)**. A category may now have **multiple** child categories.

| Before                                | After                                                 |
| ------------------------------------- | ----------------------------------------------------- |
| `childCategoryId: ObjectId \| null`   | `childCategoryIds: ObjectId[]` (default `[]`)         |
| Response field `child_category`       | Response field `child_categories` (array)             |

Migration: each existing row's single child should be backfilled as `childCategoryIds: [oldId]`, or `[]` if it was null.

## Endpoints

### List

```
GET /api/v1/admin/video-categories
```

Query params (unchanged):
`search`, `status` (`true`/`false`), `educatorId`, `childCategoryId`, `page`, `per_page` (max 200), `sort_by` (`name|order|created_at|updated_at`, default `order`), `sort_dir` (`asc|desc`, default `asc`).

> `childCategoryId=<id>` (singular query name kept for backward compatibility) now returns categories whose `childCategoryIds` array **contains** that id.

#### Response `200 OK`

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "...",
        "name": "Maths",
        "slug": "maths",
        "order": 1,
        "image": "https://...",
        "child_categories": [
          { "id": "...", "name": "Algebra" },
          { "id": "...", "name": "Geometry" }
        ],
        "educator": { "id": "...", "name": "..." },
        "status": true,
        "created_at": "...",
        "updated_at": "..."
      }
    ],
    "pagination": { "page": 1, "per_page": 200, "total": 42 }
  }
}
```

### Get one

```
GET /api/v1/admin/video-categories/:id
```

Same item shape as list.

### Create

```
POST /api/v1/admin/video-categories   (multipart/form-data)
```

#### Body

| Field              | Type             | Required | Notes                                                                                                  |
| ------------------ | ---------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `name`             | string           | yes      | Max 255                                                                                                |
| `slug`             | string           | yes      | Unique                                                                                                 |
| `image`            | file or string   | yes      | Multipart file (becomes S3 URL) **or** existing URL                                                    |
| `order`            | number           | no       | Default `0`                                                                                            |
| `status`           | boolean          | no       | Default `true`                                                                                         |
| `educatorId`       | ObjectId         | no       |                                                                                                        |
| `childCategoryIds` | ObjectId[]       | no       | Multiple children. Accepts: JSON array, comma-separated string, or repeated form keys. See below.      |

##### `childCategoryIds` input formats accepted

To make the frontend's life easy, the API accepts any of these — all parse to the same array:

```http
# JSON body
{ "childCategoryIds": ["66f...01", "66f...02"] }
```

```http
# multipart / urlencoded — repeated keys
childCategoryIds=66f...01
childCategoryIds=66f...02
```

```http
# multipart / urlencoded — bracket keys
childCategoryIds[]=66f...01
childCategoryIds[]=66f...02
```

```http
# Comma-separated string
childCategoryIds=66f...01,66f...02
```

```http
# Single value (still wrapped to an array server-side)
childCategoryIds=66f...01
```

#### Validation

- Every id must be a valid 24-char hex ObjectId.
- Every id must reference an existing `VideoCategory`.
- Duplicates are de-duplicated server-side.
- On **update**: the category's own id cannot appear in `childCategoryIds`.

#### Errors

- `422` — validation failed; `errors.childCategoryIds` will indicate bad ids.
- `422` — `"One or more childCategoryIds are invalid"` if any id doesn't exist.
- `422` — `"childCategoryIds cannot include the category itself"` (update only).
- `409` — slug already exists.

### Update

```
PUT /api/v1/admin/video-categories/:id   (multipart/form-data)
```

Same body fields as create; all optional. Sending `childCategoryIds` **replaces** the array (it is not an append). Send `[]` (or `childCategoryIds=` with no value handled as empty) to clear.

### Delete

```
DELETE /api/v1/admin/video-categories/:id
```

Refuses (`409`) if any video uses this category, or if any other category lists it in its `childCategoryIds`.

### Duplicate

```
POST /api/v1/admin/video-categories/:id/duplicate
```

Clones the **entire subtree** (DAG-safe — each unique node cloned once, cycles guarded), rewires `childCategoryIds` to the new ids, clones videos under each mapped category. Returns the new root.

### Toggle status

```
PATCH /api/v1/admin/video-categories/:id/status
```

Flips `status`.

## Source

- Model: [src/models/course/VideoCategory.model.ts](../src/models/course/VideoCategory.model.ts)
- Controller: [src/admin/videoCategory/videoCategory.controller.ts](../src/admin/videoCategory/videoCategory.controller.ts)
- Validation: [src/admin/videoCategory/videoCategory.validation.ts](../src/admin/videoCategory/videoCategory.validation.ts)
- Routes: [src/admin/videoCategory/videoCategory.routes.ts](../src/admin/videoCategory/videoCategory.routes.ts)
