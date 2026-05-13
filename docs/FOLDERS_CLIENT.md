# Client Folder APIs — Video Folders & Material Folders

The previous unified `/api/v1/client/folders` CRUD has been **removed** and replaced with two dedicated CRUDs:

- `/api/v1/client/video-folders` — folders that hold **videos** only.
- `/api/v1/client/material-folders` — folders that hold **materials** only.

Both use the same underlying `ws_folders` collection (distinguished by a `type` field), but are exposed as independent route trees with strict per-type isolation.

---

## Data model

`ws_folders` documents now carry two extra fields:

| Field             | Type                  | Notes                                                                 |
| ----------------- | --------------------- | --------------------------------------------------------------------- |
| `type`            | `"video" \| "material"` | Determines which CRUD owns the folder.                                |
| `isDefaultFolder` | `boolean`             | `true` for the seeded `My Videos` / `My Materials`; `false` otherwise. |

Unique index: `(customerId, type, name)` — a customer can have one "Notes" video folder and one "Notes" material folder, but not two of either.

`ws_folder_items.kind` is enforced per route: video folders only accept `kind="video"`, material folders only accept `kind="material"`.

---

## Default folders

Every customer gets two default folders automatically:

| Type       | Name           | `isDefaultFolder` |
| ---------- | -------------- | ----------------- |
| `video`    | `My Videos`    | `true`            |
| `material` | `My Materials` | `true`            |

**Lifecycle:**

- **Updatable:** `PATCH /video-folders/:id` and `PATCH /material-folders/:id` work on defaults (rename allowed).
- **Not deletable:** `DELETE` on a default folder returns `403 Forbidden`.
- **Auto-seeded** at:
  - First successful OTP verification (signup) — `src/client/auth/auth.service.ts`.
  - Admin-created customers — `src/admin/customer/customer.controller.ts`.
  - Lazy backstop: every `GET /list` call runs `ensureDefaultFolders(customerId)` so any missed user gets them on first access.
- **Backfill:** for existing customers, run:
  ```
  npx ts-node scripts/seed-default-folders.ts
  ```
  Idempotent; safe to re-run.

The seed uses an upsert keyed on `(customerId, type, isDefaultFolder: true)`, so duplicates can't occur even under concurrent calls.

---

## Endpoints

All routes require `Authorization: Bearer <token>`. Replace `{resource}` with either `video-folders` or `material-folders`.

### `GET /api/v1/client/{resource}`
List all folders of this type for the authenticated customer.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f...",
      "customerId": "65a...",
      "name": "My Videos",
      "type": "video",
      "isDefaultFolder": true,
      "itemCount": 3,
      "createdAt": "...",
      "updatedAt": "..."
    },
    {
      "_id": "65f...",
      "name": "Revision",
      "type": "video",
      "isDefaultFolder": false,
      "itemCount": 0
    }
  ]
}
```

Default folder is sorted to the top (`isDefaultFolder: -1, createdAt: -1`).

---

### `POST /api/v1/client/{resource}`
Create a custom folder. `isDefaultFolder` is always `false` for user-created folders — the field is server-controlled.

**Body:** `{ "name": "Revision" }`

**Responses:**
- `201` — folder created.
- `400` — `name` missing or > 120 chars.
- `409` — a folder of this type with the same name already exists.

---

### `GET /api/v1/client/{resource}/:id`
Folder detail with paginated items.

**Query:** `?page=1&limit=20`

**Response:**
```json
{
  "success": true,
  "data": {
    "folder": { "_id": "...", "name": "...", "type": "video", "isDefaultFolder": true },
    "list": [
      { "_id": "...", "kind": "video", "refId": "...", "addedAt": "...", "ref": { ...video... } }
    ]
  },
  "pagination": { "total": 1, "page": 1, "limit": 20, "totalPages": 1 }
}
```

Items are filtered by the folder's allowed kind, and `ref` is hydrated from the corresponding `Video` / `Material` model.

---

### `PATCH /api/v1/client/{resource}/:id`
Rename a folder. Works on both default and custom folders.

**Body:** `{ "name": "New name" }`

**Responses:**
- `200` — updated.
- `400` — invalid name.
- `404` — not found / not yours / wrong type.
- `409` — duplicate name within this type.

---

### `DELETE /api/v1/client/{resource}/:id`
Delete a folder and all its items (transactional).

**Responses:**
- `200` — deleted.
- `403` — folder is a default folder (`isDefaultFolder: true`).
- `404` — not found / not yours / wrong type.

---

### `POST /api/v1/client/{resource}/:id/items`
Attach a video (or material) to a folder.

**Body:** `{ "refId": "65a..." }`

The `kind` is implicit (`video` for `/video-folders`, `material` for `/material-folders`). Cross-type attaches are not possible.

**Responses:**
- `201` — item attached.
- `200` with `"deduped": true` — already attached (idempotent).
- `404` — folder or ref not found.

---

### `DELETE /api/v1/client/{resource}/:id/items/:itemId`
Detach an item. The item must belong to the folder, the authenticated customer, and match the folder's kind — otherwise `404`.

---

## Migration notes

1. **Existing data:** any pre-existing folders in `ws_folders` will be missing the new `type` field. If you have legacy data, either:
   - Drop & recreate the collection (acceptable if no production data depended on the old unified CRUD), **or**
   - Run a one-off update to set `type` based on existing item kinds before deploying.
2. **Removed routes:** `/api/v1/client/folders/*` no longer exists. Clients must migrate to the two new paths.
3. **Removed item kind:** `ebook` is no longer attachable via these CRUDs. If ebook collections are required, add a third CRUD with the same pattern.

---

## File map

| Path                                                  | Role                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| `src/models/customer/Folder.model.ts`                 | Folder schema with `type` + `isDefaultFolder`.                      |
| `src/client/folder/folder.controller.ts`              | `videoFolderController`, `materialFolderController`, `ensureDefaultFolders`. |
| `src/client/folder/folder.routes.ts`                  | Two routers built from a shared factory.                            |
| `src/client/client.routes.ts`                         | Mounts both routers under `/video-folders` and `/material-folders`. |
| `src/client/auth/auth.service.ts`                     | Seeds defaults on first OTP verification.                           |
| `src/admin/customer/customer.controller.ts`           | Seeds defaults when an admin creates a customer.                    |
| `scripts/seed-default-folders.ts`                     | One-shot backfill for existing customers.                           |
