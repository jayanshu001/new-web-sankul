# Banners — Client API

## Endpoints
- `GET /api/v1/client/cms/banners` — dedicated banner list.
- `GET /api/v1/client/dashboard` — home dashboard; the `"banner"` section's `data` array uses the same shape described below (also populated).

**Auth:** Bearer token (required, like all client endpoints).

**Query params:**
- `key` *(optional)* — filter to banners of a single type. One of: `Packages` | `Courses` | `Book` | `EBook`.

## Behavior
Returns all banners (or the subset matching `key`), sorted by `orderBy` ascending. The linked item (Package / Course / Book / Ebook) is populated into `keyId` so the client does not need a follow-up call.

## Response shape

```json
{
  "success": true,
  "data": [
    {
      "_id": "6724a1b0c5e2b40012ab34cd",
      "image": "https://cdn.example.com/banners/abc.jpg",
      "key": "Courses",
      "keyId": {
        "_id": "68d3a1f0c5e2b40012ab34cd",
        "title": "Full Stack Bootcamp",
        "thumbnail": "https://...",
        "...": "...other fields of the linked Course document"
      },
      "keyRef": "Course",
      "orderBy": 1,
      "createdAt": "2026-05-01T10:00:00.000Z",
      "updatedAt": "2026-05-12T08:30:00.000Z"
    }
  ]
}
```

### Field reference
| Field        | Type                                              | Notes |
|--------------|---------------------------------------------------|-------|
| `_id`        | string (ObjectId)                                 | Banner id. |
| `image`      | string (URL)                                      | S3 banner image URL. |
| `key`        | `"Packages" \| "Courses" \| "Book" \| "EBook"`  | Type of linked entity. May be absent on legacy rows. |
| `keyId`      | populated object **or** ObjectId string **or** `null` | The linked Package/Course/Book/Ebook document. If the referenced item was deleted, this is `null`. On legacy rows where `keyRef` is missing, populate is skipped and the raw ObjectId string is returned. |
| `keyRef`     | `"Package" \| "Course" \| "Book" \| "Ebook"`    | Internal Mongoose model name used for populate. Clients can ignore. |
| `orderBy`    | number                                            | Sort order, ascending. |
| `createdAt`  | string (ISO date)                                 | |
| `updatedAt`  | string (ISO date)                                 | |

## Key → linked model
| `key`      | Populated entity | Mongoose model |
|------------|------------------|----------------|
| `Packages` | Package          | `Package`      |
| `Courses`  | Course           | `Course`       |
| `Book`     | Book             | `Book`         |
| `EBook`    | Ebook            | `Ebook`        |

## Client tap behavior
When the user taps a banner, route by `key`:

```ts
switch (banner.key) {
  case "Packages": openPackage(banner.keyId);  break;
  case "Courses":  openCourse(banner.keyId);   break;
  case "Book":     openBook(banner.keyId);     break;
  case "EBook":    openEbook(banner.keyId);    break;
}
```

`banner.keyId` is the fully populated object — read `_id`, `title`, etc. directly. Guard against `keyId === null` (referenced item deleted).

## Example

**Request**
```
GET /api/v1/client/cms/banners?key=Courses
Authorization: Bearer <token>
```

**Response 200**
```json
{
  "success": true,
  "data": [
    {
      "_id": "6724a1b0c5e2b40012ab34cd",
      "image": "https://cdn.example.com/banners/promo-course.jpg",
      "key": "Courses",
      "keyId": {
        "_id": "68d3a1f0c5e2b40012ab34cd",
        "title": "Full Stack Bootcamp"
      },
      "keyRef": "Course",
      "orderBy": 1,
      "createdAt": "2026-05-01T10:00:00.000Z",
      "updatedAt": "2026-05-12T08:30:00.000Z"
    }
  ]
}
```

## Breaking change note
Previously `keyId` was a number. It is now an ObjectId — and in the client list response, a **populated object** (or `null`). Mobile/web clients reading `banner.keyId` as a number must be updated to read `banner.keyId?._id` (and other populated fields) instead.
