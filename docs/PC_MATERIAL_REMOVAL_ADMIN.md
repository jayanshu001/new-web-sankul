# PC Material Field Removed — Admin UI Cleanup Required

**Date:** 2026-05-16
**Backend status:** Removed in this branch.
**Action required:** Frontend (admin panel) must remove the **PC Material** dropdown / display from the Package and Course forms.

---

## What was removed on the backend

The `pcMaterialId` field has been deleted from two models and all related endpoints:

1. **Package** (`ws_packages` collection)
2. **Course** (`ws_courses` collection)

The field referenced the `PackageCourseMaterial` master and was only used for display — it never participated in any business logic (no filtering, no pricing, no entitlement). It is no longer accepted in request payloads, no longer populated in responses, and no longer present in either schema.

---

## Affected APIs

### Admin endpoints

| Endpoint | Change |
|---|---|
| `GET  /api/v1/admin/packages` | Response items no longer contain `pcMaterialId` |
| `GET  /api/v1/admin/packages/:id` | Same as above |
| `POST /api/v1/admin/packages` | `pcMaterialId` in body is **ignored** (silently stripped) |
| `PUT  /api/v1/admin/packages/:id` | `pcMaterialId` in body is **ignored** |
| `GET  /api/v1/admin/courses` | Response items no longer contain `pcMaterialId` |
| `GET  /api/v1/admin/courses/:id` | Same as above |
| `POST /api/v1/admin/courses` | `pcMaterialId` in body is **ignored** |
| `PUT  /api/v1/admin/courses/:id` | `pcMaterialId` in body is **ignored** |

Validation schemas no longer list `pcMaterialId`. Because Zod strips unknown keys by default, **old admin builds will not break** — they will just keep sending a field the server discards. But the UI should still be cleaned up so admins stop seeing/selecting a value that has no effect.

### Course material master (UNCHANGED)

The PC Material master CRUD is still available — those endpoints continue to work in case PC Material is reused elsewhere in the future:

- `GET    /api/v1/admin/courses/materials`
- `POST   /api/v1/admin/courses/materials`
- `PUT    /api/v1/admin/courses/materials/:materialId`
- `DELETE /api/v1/admin/courses/materials/:materialId`

> Note: the prior "in-use" guard on **DELETE material** has been removed (no Course references PC Material anymore), so admins can now delete a PC Material freely.

---

## Admin UI changes required

### 1. Package form (Create / Edit)

- **Remove** the "PC Material" dropdown / selector.
- **Remove** any display of the PC Material title on the package list table and detail view.
- **Stop sending** `pcMaterialId` in the request body for `POST /admin/packages` and `PUT /admin/packages/:id`.

### 2. Course form (Create / Edit)

- **Remove** the "PC Material" dropdown / selector.
- **Remove** any display of the PC Material title on the course list table and detail view.
- **Stop sending** `pcMaterialId` in the request body for `POST /admin/courses` and `PUT /admin/courses/:id`.

### 3. PC Material master screen

- Leave it as-is. The CRUD still works. If you want to also retire this screen from the admin menu, that is a separate decision — let backend know and we can fully delete the `PackageCourseMaterial` model/collection.

---

## Migration / data notes

- Existing `pcMaterialId` values in MongoDB documents are now orphaned (the field is no longer in the Mongoose schema, so reads will not return it and writes will not update it).
- No data migration is strictly required — the field just becomes invisible.
- Optional cleanup (run later from a Mongo shell if desired):
  ```js
  db.ws_packages.updateMany({}, { $unset: { pcMaterialId: "" } });
  db.ws_courses.updateMany({}, { $unset: { pcMaterialId: "" } });
  ```

---

## Rollback

If anything goes wrong, revert the commit on this branch. No DB migration was run, so there is nothing to undo on the data side.
