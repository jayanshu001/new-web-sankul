# Response — Video category form: Child Categories picker (server search + tree)

**Date:** 2026-10-01
**Status:** ✅ Backend done. Admin FE (`websankul-admin`, `AddVideoCategoryAdminModal`)
switched from filtering the loaded table page to the server-searched
`useServerTreeCategoryPicker`.

---

## 1. Ask

On the Add/Edit Video Category form, the **Child Categories** dropdown
(`GET /api/v1/admin/video-categories?search=…&status=active&sort_by=name&sort_dir=asc&per_page=50`)
should:
1. show the hierarchy as an indented tree, the same as the Add Video category picker, and
2. find ANY category by search (it only filtered the 50 rows loaded in the table).

A "disable categories with videos" rule was tried and dropped: the picked category is the
CHILD, and a child holding videos is normal.

## 2. What changed (additive only — every existing key kept)

Applies to every endpoint that returns this video-category DTO, so the shape stays the
same everywhere: `GET /admin/video-categories` (list), `GET /admin/video-categories/:id`,
and the `data` of `POST /` / `PUT /:id`.

| Key | Where | Meaning |
|---|---|---|
| `hasVideos` | row **and** every `child_categories[]` node | `true` when ≥1 video is directly in that category (`ws_video.vcategory_id`). Informational only — nothing is blocked on it |
| `child_categories[].hasChildren` | every node | node has sub-categories |
| `child_categories[].child_categories` | every node | **recursive** — the full descendant tree, not just one level |

Already present and unchanged: `parentId`, `ancestors[{id,name}]` (root → immediate
parent, for the greyed parent rows above a search match), `hasChildren`.
`child_categories[]` keeps its existing keys (`id, name, slug, status, order`) in the same
order (child's `order`, ascending).

```json
{
  "id": "3560",
  "name": "Current Affairs By Parth Sir",
  "parentId": null,
  "ancestors": [],
  "hasChildren": true,
  "hasVideos": false,
  "child_categories": [
    {
      "id": "3561", "name": "July 2026 (All Central Exam)", "slug": "…", "status": true, "order": 1,
      "hasVideos": true, "hasChildren": false, "child_categories": []
    }
  ],
  "…": "other existing keys unchanged"
}
```

## 3. FE rendering

- Greyed rows above a match: `ancestors` (same as the Add Video picker).
- Indented rows below a match: walk `child_categories` recursively.

## 4. Notes

- Search matches anywhere in the title or slug. Each word only has to appear somewhere,
  so `Part B` also matches "…Parth Sir…". Searching `romit` returns nothing because the
  category is named "Romil Sir".
- Linking moves the child: a category has ONE parent here, so adding it under this
  category removes it from its previous parent (and that tree's products).
- Video create/update/delete/status/reorder now flushes the video-category response
  cache, so `hasVideos` is fresh right away.
