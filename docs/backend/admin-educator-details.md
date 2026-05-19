# Admin – Educator Details (aggregate)

One-shot endpoint that returns everything the admin Educator Detail page needs:
profile, all associations (courses, live courses, live course folders, live
sessions, video categories, packages), and a summary block.

## Endpoint

```
GET /api/v1/admin/master/educators/:id/details
```

- **Auth**: Bearer token, role `admin` or `super_admin`
  (enforced router-wide by `authenticate` + `requireRole("admin", "super_admin")`
  in [master.routes.ts:14](src/admin/master/master.routes.ts#L14)).
- **Path params**: `id` — Educator `_id` (Mongo ObjectId, refs `CourseEducator`).
- **Query params**: none. This is a single aggregate fetch.

## Response (200)

```jsonc
{
  "success": true,
  "data": {
    "profile": {
      "_id": "…",
      "name": "…",
      "image": "…",
      "about": "…",
      "email": "…",
      "view": 0,
      "status": true,
      "createdAt": "…",
      "updatedAt": "…"
      // password is stripped
    },

    "associations": {
      "courses": [
        {
          "_id": "…",
          "name": "…", "image": "…", "level": "…",
          "isPaid": true, "isPopular": false,
          "status": true, "ordered": 1,
          "subscribersCount": 142,        // verified + active
          "createdAt": "…"
        }
      ],

      "liveCourses": [
        {
          "_id": "…",
          "name": "…", "image": "…", "level": "…",
          "classType": "live",            // live | live_offline | offline
          "isPaid": true, "isPopular": false,
          "status": true, "ordered": 1,
          "subscribersCount": 87,
          "createdAt": "…"
        }
      ],

      "liveCourseFolders": [
        // VideoCategory docs scoped to a live course
        {
          "_id": "…",
          "title": "…", "slug": "…", "image": "…",
          "status": true, "order_by": 0,
          "liveCourseId": { "_id": "…", "name": "…" },
          "courseId": null,
          "createdAt": "…"
        }
      ],

      "liveSessions": [
        {
          "_id": "…",
          "title": "…", "subject": "…",
          "status": "ENDED",              // SCHEDULED | CREATED | READY | ENDED
          "scheduledAt": "…", "endAt": "…",
          "liveCourseId": { "_id": "…", "name": "…" },
          "createdAt": "…"
        }
      ],

      "videoCategories": [
        // VideoCategory docs NOT scoped to a live course (root / course-level)
        {
          "_id": "…",
          "title": "…", "slug": "…", "image": "…",
          "status": true, "order_by": 0,
          "courseId": "…",                // may be null
          "liveCourseId": null,
          "createdAt": "…"
        }
      ],

      "packages": [
        {
          "_id": "…",
          "name": "…", "image": "…",
          "isPaid": true, "active": true, "status": true, "order": 1,
          "subscribersCount": 23,
          "createdAt": "…"
        }
      ]
    },

    "summary": {
      "totals": {
        "courses": 5,
        "liveCourses": 3,
        "liveCourseFolders": 18,
        "liveSessions": 47,
        "videoCategories": 4,
        "packages": 2
      },
      "active": {
        "courses": 4,            // status === true
        "liveCourses": 2,
        "packages": 2
      },
      "totalSubscribers": 252,   // sum across courses + liveCourses + packages
      "totalSessionsConducted": 31  // liveSessions with status === "ENDED"
    }
  }
}
```

## Errors

| Status | Body                                                | When                              |
| ------ | --------------------------------------------------- | --------------------------------- |
| 400    | `{ success:false, message:"Invalid Educator ID" }`  | `:id` is not a valid ObjectId     |
| 401    | (from `authenticate`)                               | Missing / invalid Bearer token    |
| 403    | (from `requireRole`)                                | Caller is not admin / super_admin |
| 404    | `{ success:false, message:"Educator not found" }`   | Educator doc does not exist       |
| 500    | `{ success:false, message }`                        | Unexpected error                  |

## Implementation notes

- Handler: `getEducatorDetails` in
  [educator.controller.ts](src/admin/master/educator.controller.ts).
- The `CourseEducator` model has no soft-delete flag; existence check uses
  `findById` alone — see
  [CourseEducator.model.ts](src/models/course/CourseEducator.model.ts).
- Profile is intentionally lean: `CourseEducator` only stores
  `name / image / about / email / view / status` (plus timestamps). The
  original spec's `bio / designation / qualification / experienceYears /
  subjects` fields do **not** exist on the model and were dropped per
  explicit confirmation. If those need to ship, add them to the schema first.
- **Linkage fields**:
  - `Course.courseEducatorId` (single ref)
  - `LiveCourse.courseEducatorId` (single ref)
  - `VideoCategory.educatorId` (single ref) — split into `liveCourseFolders`
    (docs with `liveCourseId` set) vs `videoCategories` (the rest), in line
    with how the VideoCategory collection is dual-purposed.
  - `LiveSession.educatorId` (single ref)
  - `Package.educatorId` (single ref)
- **Subscriber counts** are computed in parallel via `countDocuments`,
  filtering `{ paymentStatus: "verified", status: true }`:
  - Course: `PackageCourseSubscription.courseId`
  - LiveCourse: `LiveCourseSubscription.liveCourseId`
  - Package: `PackageCourseSubscription.targetPackageId`
- `summary.totalSubscribers` = sum of `subscribersCount` across courses +
  liveCourses + packages.
- `summary.totalSessionsConducted` = count of `liveSessions` with
  `status === "ENDED"` (matches the real `LiveSession` status enum).
- All five association queries run in parallel via `Promise.all`; subscriber
  counts then fan out in a second parallel batch.
- Endpoint is intentionally **un-paginated** — it powers a single detail
  screen. If an educator's footprint grows large in one section, point the UI
  at the existing filtered list endpoint for that resource.
