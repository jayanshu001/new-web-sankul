# Educator Detail — Profile + Courses

Single endpoint that powers the **Educator Profile** screen (Course tab + About tab). Returns the educator's profile and the list of active courses they teach, including price plans — so the frontend can render the course cards and the about section without a second round-trip.

**Auth:** `Authorization: Bearer <token>` required (customer role).

---

## `GET /api/v1/client/educators/:id`

### Path params

| Param | Type     | Description                                |
| ----- | -------- | ------------------------------------------ |
| `id`  | ObjectId | The `_id` of the `CourseEducator` document |

### Behavior

- Returns the educator only if `status: true`; otherwise `404`.
- `courses[]` includes only active courses (`status: true`) where `courseEducatorId === :id`, sorted by `createdAt` desc.
- Each course is decorated with a `plans` object grouped by material flag (same shape as `GET /api/v1/client/courses`):
  - `plans.withMaterial[]` — price rows where `withMaterial: true`
  - `plans.withoutMaterial[]` — price rows where `withMaterial: false`
  - Each array is sorted by `duration` asc (plan duration is in **months**).
- Increments the educator's `view` counter fire-and-forget (does not block the response).

### Success response — `200`

```json
{
  "success": true,
  "message": "Educator details fetched successfully.",
  "data": {
    "educator": {
      "_id": "65f...",
      "name": "Abhijeetsinh Zala",
      "image": "https://cdn.../educator.jpg",
      "email": "abhijeet20@yahoo.com",
      "about": "અભિજીતસિંહ ઝાલા છેલ્લા 3 વર્ષથી...",
      "view": 142,
      "status": true,
      "createdAt": "2025-08-12T10:14:22.000Z",
      "updatedAt": "2026-05-10T08:01:11.000Z"
    },
    "courses": [
      {
        "_id": "66a...",
        "name": "Gujarat Geography",
        "description": "Planner Course - Gujarat Geography",
        "image": "https://cdn.../course.jpg",
        "level": "beginner",
        "status": true,
        "isPaid": true,
        "isPopular": false,
        "courseEducatorId": {
          "_id": "65f...",
          "name": "Abhijeetsinh Zala",
          "image": "https://cdn.../educator.jpg"
        },
        "courseSubjectCategoryId": { "_id": "...", "title": "Geography" },
        "videoCategoryId": { "_id": "...", "title": "..." },
        "pcMaterialId": { "_id": "...", "title": "..." },
        "plans": {
          "withMaterial": [
            { "_id": "...", "duration": 3, "price": 1299, "discountedPrice": 999, "withMaterial": true }
          ],
          "withoutMaterial": [
            { "_id": "...", "duration": 3, "price": 999, "discountedPrice": 899, "withMaterial": false }
          ]
        }
      }
    ],
    "totalCourses": 1
  }
}
```

### Error responses

| Status | When                                        | Body                                                       |
| ------ | ------------------------------------------- | ---------------------------------------------------------- |
| `400`  | `:id` is not a valid ObjectId               | `{ "success": false, "message": "Please select valid educator" }` |
| `401`  | Missing / invalid Bearer token              | `{ "success": false, "message": "Unauthorized request." }` |
| `404`  | Educator not found or `status: false`       | `{ "success": false, "message": "Educator not found" }`    |
| `500`  | Unexpected server error                     | `{ "success": false, "message": "<error>" }`               |

---

## Frontend mapping (from the design)

| UI element                       | Source field                                |
| -------------------------------- | ------------------------------------------- |
| Header avatar                    | `educator.image`                            |
| Header name                      | `educator.name`                             |
| **About tab** — "Name : ..."     | `educator.name`                             |
| **About tab** — "Email ID : ..." | `educator.email`                            |
| **About tab** — bio bullets      | `educator.about` (split by newline on FE)   |
| **Course tab** — card image      | `courses[i].image`                          |
| **Course tab** — card title      | `courses[i].name`                           |
| **Course tab** — "By {name}"     | `courses[i].courseEducatorId.name`          |
| **Course tab** — price           | `courses[i].plans.withoutMaterial[0].discountedPrice` (or `.withMaterial[0]` per UX) |
| Join Now → course detail         | `GET /api/v1/client/courses/:id` with `courses[i]._id` |

---

## Notes

- The endpoint is **list + detail combined** by design — the educator screen always needs both, so one call avoids a flicker between the header render and the cards.
- If you later need a paginated educator list (e.g. "All Educators" screen), add `GET /api/v1/client/educators` separately; this route is intentionally `:id`-only.
- Course plan `duration` is in **months** — compute display text on the FE (e.g. `${duration} months` or convert to years for `12`).
