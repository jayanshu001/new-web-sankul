# Live Course — Admin Form: "Live Course Category" Field

Backend reference: `src/admin/live-course/live-course.controller.ts`, `src/admin/live-course/live-course.validation.ts`, `src/models/course/LiveCourse.model.ts`.

A new optional field `liveCourseCategoryId` was added to the Live Course CRUD. This doc tells the admin frontend exactly how to add the dropdown to the existing Live Course create/edit form.

---

## 1. What changed on the backend

- `LiveCourse.liveCourseCategoryId: ObjectId | null` (default `null`).
- Accepted by `POST /api/v1/admin/live-courses` and `PUT /api/v1/admin/live-courses/:id`.
- Validated as ObjectId; if non-null, the referenced LiveCourseCategory must exist (else `422 liveCourseCategoryId does not reference an existing live course category.`).
- Returned by `GET /api/v1/admin/live-courses` and `GET /api/v1/admin/live-courses/:id`, **populated** as `{ _id, title, slug, image }`.

No path changes. No breaking changes — the field is optional.

---

## 2. UI Wiring

### 2.1 Add a "Live Course Category" dropdown to the form

Add it to the Live Course create/edit form next to the existing **Course Subject Category** dropdown.

- **Label**: `Live Course Category`
- **Placeholder**: `Select a live course category`
- **Required**: no (allow "None" to send `null` / omit the field)
- **Data source**: `GET /api/v1/admin/master/live-course-categories`
  - Response shape: `{ success, data: [{ _id, title, slug, image, order, status }] }`
  - Render `title` as the option label; bind `_id` as the value.
  - Filter out `status: false` rows on the client (or sort them last) if you want admins to avoid retired categories.

### 2.2 Wire it into the payload

`POST /api/v1/admin/live-courses` / `PUT /api/v1/admin/live-courses/:id` accept the field in the same JSON / multipart body you already use:

```jsonc
{
  "name": "JEE Advanced 2026 Live Batch",
  "description": "...",
  "image": "https://...",
  "ordered": 0,
  "level": "Advanced",
  "status": true,
  "courseEducatorId": "664a...",
  "courseSubjectCategoryId": "664b...",
  "liveCourseCategoryId": "67f3..."   // ← new field
}
```

- Omit the key (or send `undefined`) when the admin selects "None".
- The backend will not coerce empty strings — if the admin clears the field on edit, send `undefined` (i.e. don't include the key at all). To **explicitly null** on edit, you can `PUT` without the field; the existing value will persist. If true detach is required, the form should call PUT with the field omitted **after** confirming you intend to keep current behavior. (If a "Detach" affordance is needed, file a follow-up — we'd add a `null` accept path in validation.)

### 2.3 Pre-fill on edit

`GET /api/v1/admin/live-courses/:id` returns `liveCourse.liveCourseCategoryId` populated:

```jsonc
{
  "liveCourse": {
    "_id": "...",
    "liveCourseCategoryId": {
      "_id": "67f3...",
      "title": "JEE Live",
      "slug": "jee-live",
      "image": "https://cdn.../jee-live.png"
    },
    // ... rest of the live course
  }
}
```

Bind the dropdown value to `liveCourse.liveCourseCategoryId?._id` when rendering the edit form.

### 2.4 Pre-fill on list

`GET /api/v1/admin/live-courses` also populates `liveCourseCategoryId` per row — so you can render a "Category" column in the listing table without an extra fetch.

```jsonc
{
  "liveCourses": [
    {
      "_id": "...",
      "name": "JEE Advanced 2026 Live Batch",
      "liveCourseCategoryId": {
        "_id": "67f3...",
        "title": "JEE Live",
        "slug": "jee-live",
        "image": "https://cdn.../jee-live.png"
      }
    }
  ]
}
```

---

## 3. Error Handling

| Status | When | Body |
|---|---|---|
| 422 | `liveCourseCategoryId` is not a valid ObjectId | `{ success: false, message: "Validation failed.", errors: ["liveCourseCategoryId: Invalid ObjectId"] }` |
| 422 | `liveCourseCategoryId` ObjectId doesn't exist in `ws_live_course_categories` | `{ success: false, message: "liveCourseCategoryId does not reference an existing live course category." }` |

Both should surface as inline form errors on the dropdown.

---

## 4. QA Checklist

- [ ] Dropdown appears on **Create Live Course** and **Edit Live Course** forms.
- [ ] Dropdown is populated from `GET /api/v1/admin/master/live-course-categories`.
- [ ] Selecting a category and submitting persists it (verify via `GET /api/v1/admin/live-courses/:id`).
- [ ] On edit, the previously selected category is pre-selected.
- [ ] Listing page renders a "Category" column using the populated value.
- [ ] Submitting an invalid ObjectId surfaces the 422 inline on the dropdown.
