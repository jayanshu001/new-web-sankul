# List Live Courses by Category (Client)

Returns active live courses that belong to a given live course category. Powers the "Categories Inner" screen on the client app.

## Endpoint

```
GET /api/v1/client/live-course-categories/:id/live-courses
```

## Auth

Required. Send a Bearer token in the `Authorization` header.

```
Authorization: Bearer <token>
```

## Path Parameters

| Name | Type   | Required | Description                                  |
| ---- | ------ | -------- | -------------------------------------------- |
| `id` | string | yes      | MongoDB ObjectId of the live course category |

## Behavior

- Filters `LiveCourse` documents by `liveCourseCategoryId = :id` and `status = true`.
- Sorts ascending by `ordered`.
- Returns a trimmed projection suitable for category listing screens.

## Success Response — `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "_id": "66f0a1b2c3d4e5f600000001",
      "name": "PSI Constable",
      "image": "https://cdn.example.com/live-courses/psi-constable.jpg",
      "ordered": 1,
      "isPaid": true,
      "isPopular": false,
      "classType": "live"
    }
  ]
}
```

### Response Fields

| Field       | Type    | Description                                          |
| ----------- | ------- | ---------------------------------------------------- |
| `_id`       | string  | Live course ID                                       |
| `name`      | string  | Live course name                                     |
| `image`     | string  | Thumbnail / banner URL                               |
| `ordered`   | number  | Display order (ascending)                            |
| `isPaid`    | boolean | Whether the course requires payment                  |
| `isPopular` | boolean | Marks the course as popular                          |
| `classType` | string  | One of `"live"`, `"live_offline"`, `"offline"`       |

## Error Responses

### `400 Bad Request` — invalid id

```json
{ "success": false, "message": "Invalid live course category id" }
```

### `401 Unauthorized` — missing/invalid token

Returned by the auth middleware when the Bearer token is absent or invalid.

### `500 Internal Server Error`

```json
{ "success": false, "message": "<error message>" }
```

## Notes

- Inactive live courses (`status = false`) are excluded.
- An unknown but valid ObjectId returns `200 OK` with `data: []`.
- Pricing fields are not returned by this endpoint; fetch live course details separately when needed.

## Source

- Controller: [src/client/categories/categories.controller.ts](../src/client/categories/categories.controller.ts) → `listLiveCoursesByCategory`
- Route: [src/client/categories/categories.routes.ts](../src/client/categories/categories.routes.ts)
