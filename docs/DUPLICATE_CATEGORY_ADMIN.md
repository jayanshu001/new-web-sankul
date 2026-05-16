# Duplicate Material / Video Category — Admin Frontend Integration

Backend reference: `POST /api/v1/admin/material/categories/:id/duplicate` and `POST /api/v1/admin/videoCategory/:id/duplicate`.

This doc is everything the admin frontend needs to wire up the Duplicate action — no backend questions, no extra discovery required.

---

## 1. Mental Model

Clicking **Duplicate** on a row creates an independent deep copy of that category and everything nested inside it (sub-categories + materials / videos). The copy:

- Lands in the **same listing** the admin is already looking at — no separate "Unassigned" tab, no filter toggle. The frontend just re-fetches the current list and the new row appears.
- Has its top-level name suffixed with `(Copy)` (or `(Copy 2)`, `(Copy 3)`, … if that name is already taken).
- For **material categories**: lives under the **same parent** as the source. If the source was a root category, the copy is a root category.
- For **video categories**: starts in an **unassigned** state — `courseId`, `liveCourseId`, `educatorId` are all `null`. The admin reassigns it later via the existing edit endpoint when they're ready to attach it to a new Course / LiveCourse / educator.
- References the same file/video URLs as the source (no re-upload, no re-encode). Swapping them is something the admin can do later in edit mode.

The intended workflow: admin builds up a reusable library of category templates by duplicating well-structured ones, then attaches the duplicates to new courses as they're created.

---

## 2. Endpoints

### 2.1 Material Category

```
POST /api/v1/admin/material/categories/:id/duplicate
Authorization: Bearer <admin token>
Content-Type: application/json
Body: (none)
```

**200 OK**
```json
{
  "success": true,
  "data": {
    "id": "65f2...",
    "name": "Physics Notes (Copy)",
    "parent": null,
    "createdAt": "2026-05-15T10:23:00.000Z",
    "itemsCloned": {
      "subCategories": 4,
      "materials": 27
    }
  }
}
```

**Error responses**
| Status | When | Body |
|---|---|---|
| 400 | `:id` is not a valid ObjectId | `{ success: false, message: "Invalid category id." }` |
| 401 | Missing / invalid bearer token | standard auth error |
| 403 | Caller is not admin / super_admin | standard role error |
| 404 | Source category not found | `{ success: false, message: "Category not found." }` |
| 500 | Clone failed mid-way (rollback executed, nothing persisted) | `{ success: false, message: "<reason>" }` |

### 2.2 Video Category

```
POST /api/v1/admin/videoCategory/:id/duplicate
Authorization: Bearer <admin token>
Content-Type: application/json
Body: (none)
```

**200 OK**
```json
{
  "success": true,
  "data": {
    "id": "65f2...",
    "name": "JEE Physics (Copy)",
    "courseId": null,
    "liveCourseId": null,
    "createdAt": "2026-05-15T10:23:00.000Z",
    "itemsCloned": {
      "subCategories": 2,
      "videos": 18
    }
  }
}
```

**Error responses**
| Status | When | Body |
|---|---|---|
| 400 | `:id` is not a valid ObjectId | `{ success: false, message: "Invalid Video Category ID" }` |
| 401 / 403 | Auth / role | standard |
| 404 | Source category not found | `{ success: false, message: "Video Category not found" }` |
| 500 | Clone failed (rollback executed) | `{ success: false, message: "<reason>" }` |

---

## 3. Where the Clone Appears in Existing Listings

**Material categories** — the existing call already returns the clone:
```
GET /api/v1/admin/material/categories?limit=100
```
The clone has the same `parent` as the source. If the admin is filtering by `parent=<sourceParentId>`, both source and clone will appear together. After a successful duplicate, just re-fetch the current list query — no parameter changes needed.

**Video categories** — the existing call already returns the clone:
```
GET /api/v1/admin/videoCategory?per_page=200&sort_by=order&sort_dir=asc
```
The clone has `courseId=null` and `liveCourseId=null`. Since the list endpoint does not filter on those fields, the clone shows up alongside everything else. Sort order applies normally (it will land per the chosen `sort_by`).

> If you want the clone to be visually obvious, render rows where `courseId` and `liveCourseId` are both null with a subtle "Unassigned" badge. Optional — not required.

---

## 4. UI Flow

1. **Trigger** — on each row in the Material / Video Categories list, add a **Duplicate** menu item (alongside Edit / Delete / Toggle Status). Use the same icon convention as elsewhere in admin.

2. **Confirm (optional but recommended)** — show a small confirm dialog:
   > Duplicate **"\<source name>"** and all its contents? The copy will appear as **"\<source name> (Copy)"** in this list. You can rename and reassign it after.

3. **Progress modal** — when the user confirms:
   - Open a non-dismissible modal: *"Duplicating \<source name>…"* with a spinner.
   - Disable the source row's action menu while the request is in flight (prevents double-clicks).
   - Issue the POST. No body required.

4. **On 200 success:**
   - Close the modal.
   - Show a toast: *"Duplicated. **\<itemsCloned.subCategories>** sub-categories and **\<itemsCloned.materials \| videos>** items copied."*
   - **Re-fetch the current list** (same query the page is already using). The new row will appear.
   - Optionally, briefly highlight or scroll-to the new row (the response gives you the new `id`).

5. **On 4xx / 5xx:**
   - Close the modal.
   - Show an error toast with `response.data.message`.
   - Do **not** refresh the list — nothing was persisted (the backend wraps the clone in a transaction; failures roll back).

6. **Edit-after-duplicate** — no special handling. The clone is a regular category; the existing edit form / endpoint works on it unchanged. For video categories, the admin will typically open the clone, set `courseId` / `liveCourseId` / `educatorId`, save, and it's now attached to a course.

---

## 5. Sample Frontend Code

Axios examples (drop in wherever your admin API client lives):

```ts
// Material category
export async function duplicateMaterialCategory(id: string) {
  const { data } = await adminApi.post(
    `/admin/material/categories/${id}/duplicate`
  );
  return data.data; // { id, name, parent, createdAt, itemsCloned }
}

// Video category
export async function duplicateVideoCategory(id: string) {
  const { data } = await adminApi.post(
    `/admin/videoCategory/${id}/duplicate`
  );
  return data.data; // { id, name, courseId, liveCourseId, createdAt, itemsCloned }
}
```

React handler sketch:

```tsx
async function onDuplicateClick(row: CategoryRow) {
  setBusyId(row.id);
  try {
    const result = await duplicateMaterialCategory(row.id);
    toast.success(
      `Duplicated. ${result.itemsCloned.subCategories} sub-categories and ${result.itemsCloned.materials} materials copied.`
    );
    await refetchList();      // same query the page already uses
    highlightRow(result.id);  // optional UX touch
  } catch (err: any) {
    toast.error(err?.response?.data?.message ?? "Duplicate failed");
  } finally {
    setBusyId(null);
  }
}
```

---

## 6. Edge Cases & Behavior Guarantees

| Scenario | Behavior |
|---|---|
| Source has 0 children and 0 materials/videos | Endpoint still succeeds. `itemsCloned: { subCategories: 0, materials: 0 }`. Just the top-level row is created. |
| Source name already has `(Copy)` siblings | Suffix auto-increments: `(Copy)` → `(Copy 2)` → `(Copy 3)`. Frontend doesn't need to compute this — backend does. |
| Sub-categories inside the source have colliding names | Sub-category names are kept verbatim. Only the top-level name gets the suffix. |
| Source's image / file URLs | Referenced as-is. If an admin later deletes the source, the clone's URL becomes stale. Acceptable trade-off; warn the admin if they try to delete a source that has copies, if you want — not required. |
| Video clone's `liveSessionId` | Always `null` on the clone, even if the source video was a live-session recording. The clone is a manual copy, not a recording. |
| Long-running clone (hundreds of items) | Backend targets <30s for trees up to ~1000 items. If the request takes >10s, keep the spinner visible — don't bail. The transaction either commits fully or rolls back fully. |
| User clicks Duplicate twice fast | Backend will succeed both times and produce two copies, named `(Copy)` and `(Copy 2)`. To prevent: disable the action while one request is in-flight (handled by `busyId` in §5). |
| Permissions | Auth uses the same admin/super_admin role gate as Create/Update/Delete on these resources. No new permission to wire up. |

---

## 7. What Does NOT Happen on Duplicate

To set frontend expectations correctly:

- **No new course/package association is created.** The duplicated video category is unassigned (`courseId: null, liveCourseId: null`). The admin must explicitly attach it via the existing edit flow afterwards.
- **No `PackageVideoCategoryRelation` / `VideoCategoryRelation` rows are cloned.** Package and parent-relation links represent assignments on the source — they are intentionally not carried over.
- **No files are uploaded.** All `file` / `image` / `thumbnail` URLs and platform video IDs are referenced verbatim.
- **No notifications / emails / audit hooks fire** from the duplicate action (beyond whatever auth / request logging is already global).

---

## 8. Quick Test Checklist (for QA)

- [ ] Duplicate a root material category that has 2 sub-categories and 5 materials → new row appears at root with `(Copy)` suffix; expanding it shows the same 2 sub-categories and 5 materials.
- [ ] Duplicate the same category again → second clone is named `(Copy 2)`.
- [ ] Duplicate a nested material sub-category → new row appears under the same parent, original untouched.
- [ ] Duplicate a video category with a child chain (A → B → C) and 10 videos across them → new chain (A' → B' → C') appears in the list with all 10 videos remapped.
- [ ] Open the duplicated video category and assign it to a different Course in the edit form → save succeeds, source's course assignment unchanged.
- [ ] Try to duplicate with an invalid id → 400 error toast, no row added.
- [ ] Try to duplicate while logged in as a non-admin → 403 error toast.
- [ ] Disconnect network mid-request → frontend shows error toast, refetch shows no new row (transaction rolled back).
