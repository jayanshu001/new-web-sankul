# Catalog Tabs API (Videos / Materials / Tests) — Client Integration Doc

Powers the **Videos · Materials · Test** tabs on every product detail screen —
**recorded Course**, **Package**, and **Live Course** — and the drill-down +
search screens beneath them (the mockups: "60 Materials", "23 Tests",
"80 Videos", the per-folder lists, and the per-tab search bar).

> **Design principle — one contract, three parents.**
> Materials and Tests are **global category trees** (`MaterialCategory` /
> `ExamCategory`); a Course / Package / Live Course only *references* a set of
> root category IDs. So the drill-down below the top level is **identical
> regardless of parent** and is served by endpoints that take only a category
> id. Videos are the one exception — `VideoCategory` is scoped per
> `courseId` / `liveCourseId` — so the **top-level (tab root)** call is the only
> place the backend needs to know the parent `type`. That difference is hidden
> behind a single unified entry-point so the FE sees one contract.

---

## Mental model

```
 ┌─────────────────────────────────────────────────────────────────┐
 │  TOP LEVEL  (needs parent type+id — the only parent-aware call)   │
 │  GET /catalog/:type/:id/videos | materials | tests                │
 │  → returns the root category "groups" for that tab                │
 └─────────────────────────────────────────────────────────────────┘
                              │  tap a category card
                              ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │  DRILL-DOWN  (parent-agnostic — needs ONLY a category id)         │
 │  …has children?  GET /{video|material|exam}-categories/:id/children│
 │                    ?search=                                        │
 │  …leaf items?    GET /{video|material|exam}-categories/:id/{items} │
 │                    ?search=  ?page=  ?limit=                       │
 └─────────────────────────────────────────────────────────────────┘

 ▸ SEARCH is available at every level: the top-level tab roots (§1),
   the category drill-down /children (§2), and the leaf item lists (§3).
                              │  tap a video row
                              ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │  PLAYBACK (video only)                                            │
 │  GET /video-categories/:id/videos/:videoId  → encrypted envelope  │
 └─────────────────────────────────────────────────────────────────┘
```

The FE uses `havingChildDirectory` on each category card to decide whether a tap
**drills deeper** (call `/children`) or **opens the leaf list** (call
`/{videos|materials|exams}`).

**Auth:** every endpoint here requires `Authorization: Bearer <customer token>`,
same as all other client routes.

Base path for everything below: `/api/v1/client`.

---

## Integration guide — which IDs / params to send

This is the part to read before coding. It tells you **exactly what to pass**
for each screen: the parent (`type` + `id`), a category `id`, search, and the
video `categoryIds` filter.

### The one rule to remember

- **Top level (the tab itself)** → you have a **product** in hand (course /
  package / live-course), so you send **both** `type` **and** `id`:
  `GET /catalog/:type/:id/{videos|materials|tests}`.
- **Everything below the top level** (drilling into a folder, listing items,
  playing a video) → you have a **category `_id`** in hand (from the response
  above), so you send **only the category id** — **never** the product type/id
  again. The category id alone fully identifies the node.

> Why: Materials/Tests categories are global trees and Videos categories are
> already scoped to their product at creation time, so once you hold a category
> `_id`, the parent product is irrelevant for drill-down. Don't try to thread
> `type`/`id` into §2–§4 calls — they don't accept it.

### `type` values

| You are on…            | send `type` =  |
|------------------------|----------------|
| Recorded course detail | `course`       |
| Package detail         | `package`      |
| Live course detail     | `live-course`  |

### Per-screen recipe

| Screen / action                                   | Endpoint                                                    | IDs to send            | Other params |
|---------------------------------------------------|-------------------------------------------------------------|------------------------|--------------|
| Open **Videos** tab of a product                  | `GET /catalog/:type/:id/videos`                             | `type` + product `id`  | — |
| Open **Materials** tab of a product               | `GET /catalog/:type/:id/materials`                          | `type` + product `id`  | — |
| Open **Test** tab of a product                    | `GET /catalog/:type/:id/tests`                              | `type` + product `id`  | — |
| Search within a tab's category cards              | same as the tab call above                                  | `type` + product `id`  | `?search=` |
| **Filter Videos** to chosen subjects (+search)    | `GET /catalog/:type/:id/videos`                             | `type` + product `id`  | `?categoryIds=a,b&search=` |
| Tap a category card that **has children**         | `GET /{video\|material\|exam}-categories/:id/children`      | **category `id` only** | `?search=` |
| Tap a category card that is a **leaf** (items)    | `GET /{video\|material\|exam}-categories/:id/{videos\|materials\|exams}` | **category `id` only** | `?search=&page=&limit=` |
| Play a video                                      | `GET /video-categories/:id/videos/:videoId`                 | category `id` + `videoId` | — |

> **Which `*-categories` prefix?** Match it to the tab you came from: Videos tab
> → `video-categories`, Materials tab → `material-categories`, Test tab →
> `exam-categories`. The `id` is always the category's `_id` from the previous
> response — decide drill-vs-leaf with that card's `havingChildDirectory` flag.

### Worked example — **Package → Videos, filter + search** (your highlighted case)

Package `_id = PKG1`, two subjects shown as filter chips: `CAT_REASON`, `CAT_MATHS`.

```text
1) Open the Videos tab of the package (no filter yet → all subjects):
   GET /api/v1/client/catalog/package/PKG1/videos
   → data.availableCategories = [
        { _id: "CAT_REASON", title: "Reasoning - Krunal Sir" },
        { _id: "CAT_MATHS",  title: "Maths - Krunal Sir" }, …
     ]                       // render these as the filter chips
   → data.list = [ { category, list:[…videos…] }, … ]   // all subject groups
   → data.totals.items = 80  // "80 Videos" header stat

2) User ticks "Reasoning" + "Maths" → re-call with categoryIds:
   GET /api/v1/client/catalog/package/PKG1/videos?categoryIds=CAT_REASON,CAT_MATHS
   → data.list now contains ONLY those two groups.

3) User types "alphabet" in the tab search box → add &search:
   GET /api/v1/client/catalog/package/PKG1/videos?categoryIds=CAT_REASON,CAT_MATHS&search=alphabet
   → groups' inlined videos filtered to titles matching "alphabet".

4) User taps a video row → fetch the playable, encrypted envelope:
   GET /api/v1/client/video-categories/CAT_REASON/videos/VIDEO_ID
   (category id = the group's category._id; NOT the package id)
```

> Same three steps work verbatim for `course` and `live-course` — only the
> `type` segment changes. Materials/Tests tabs use the same step 1 + search, but
> have **no** `categoryIds` filter (video-only) and drill via §2/§3 instead of
> inlining a video list.

---

## 1. Top-level tab roots (the unified entry-point)

> **STATUS: implemented & live** (`src/client/catalog/`). These unified routes
> generalize the old per-product tab data (which was embedded inside
> `GET /courses/:id` / `GET /packages/:id`) into one contract across all three
> parents, split per tab so the FE can lazy-load each tab independently.

```
GET /api/v1/client/catalog/:type/:id/videos
GET /api/v1/client/catalog/:type/:id/materials
GET /api/v1/client/catalog/:type/:id/tests
```

### Path params

| Param  | Type              | Notes |
|--------|-------------------|-------|
| `type` | enum              | `course` \| `package` \| `live-course`. Invalid → `422`. |
| `id`   | string (ObjectId) | The course / package / live-course `_id`. Invalid → `422`; not found → `404`. |

### Query params

| Param         | Type                | Applies to       | Default        | Notes |
|---------------|---------------------|------------------|----------------|-------|
| `search`      | string              | all three tabs   | `""`           | Case-insensitive substring match on the **root category name**. Filters which category cards are returned for this tab. |
| `categoryIds` | comma-sep ObjectIds | **videos only**  | _none_ (= all) | Restrict the returned video groups to these categories. See §5. Ignored for materials/tests. |

### How each `type` resolves its roots (backend behavior, FE-transparent)

| Tab       | `course`                              | `package`                              | `live-course`                                   |
|-----------|---------------------------------------|----------------------------------------|-------------------------------------------------|
| videos    | single `course.videoCategoryId` group | package's video category root(s)        | `VideoCategory.find({ liveCourseId })` folders  |
| materials | `course.materialCategories[].category`| `package.materialCategories[].category` | `liveCourse.materialCategories[].category`      |
| tests     | `course.examCategories[].category`    | `package.examCategories[].category`     | `liveCourse.examCategories[].category`          |

The FE does **not** branch on `type` — it sends the right `type` and receives
the **same response shape** every time.

### Response `200` — Materials / Tests (category groups)

```jsonc
{
  "success": true,
  "message": "Material categories fetched.",
  "data": {
    "parent": { "_id": "…", "type": "course", "name": "UPSC GS 2026 Complete Course" },
    "list": [
      {
        "category": {
          "_id": "…",
          "title": "Mission GPSC Lecture PDF",   // ExamCategory exposes `name`, aliased to `title`
          "image": "https://…",
          "havingChildDirectory": false,         // true → tap calls /children; false → tap calls leaf list
          "count": 40                            // # leaf items (materials / exams) directly under this root
        }
      }
      // …
    ],
    "totals": { "categories": 4, "items": 60 }   // drives the "60 Materials" / "23 Tests" header stat
  }
}
```

### Response `200` — Videos

Same `parent` + `totals`, but each group **inlines its leaf videos** (metadata
only — playable URLs come from the playback endpoint), mirroring today's
`buildCourseDetails` videos shape:

```jsonc
{
  "success": true,
  "message": "Video categories fetched.",
  "data": {
    "parent": { "_id": "…", "type": "live-course", "name": "Constable Hybrid Offline + Live" },
    "list": [
      {
        "category": { "_id": "…", "title": "Reasoning - Krunal Sir", "image": "…", "havingChildDirectory": false, "count": 67 },
        "list": [
          {
            "_id": "…", "title": "Lecture 01 - Alphabet And Numbers", "topic": "…",
            "platform": "aws", "priceType": "free",        // "free" | "paid" → drives the Free/Paid pill
            "order": 1,
            "youtube_id": null, "aws_id": "…", "vimeo_id": null,   // identifiers only, NOT playable
            "recordings": [ /* per-quality MP4s when promoted from a live session, else [] */ ],
            "qualities":  [ /* download-size hints for the picker */ ],
            "progress": { "positionSec": 0, "durationSec": 0, "completed": false, "completedAt": null, "lastWatchedAt": null }
          }
        ]
      }
    ],
    "totals": { "categories": 4, "items": 80 }
  }
}
```

> **Video URL contract.** Video rows here are **metadata only**. To play, the FE
> calls the playback endpoint (§4) and decrypts the `{ token, hls, progressive }`
> envelope — the same shape `/v1/lecture` returns. Never treat `aws_id` /
> `youtube_id` / `vimeo_id` as direct URLs.

> **Entitlement.** For paid `live-course` videos the row carries `priceType`;
> the actual gate runs on the playback call, which returns `403` +
> `purchaseOptions` for non-subscribers. Free rows always play.

---

## 2. Category drill-down — children (EXISTING, now with search)

Call when a tapped category has `havingChildDirectory: true`. Returns the
**child categories** of the given category.

```
GET /api/v1/client/video-categories/:id/children
GET /api/v1/client/material-categories/:id/children
GET /api/v1/client/exam-categories/:id/children
```

### Path params

| Param | Type              | Notes |
|-------|-------------------|-------|
| `id`  | string (ObjectId) | The parent category `_id`. Invalid → `400`; not found → `404`. |

### Query params

| Param    | Type   | Default | Notes |
|----------|--------|---------|-------|
| `search` | string | `""`    | **NEW.** Case-insensitive substring match on the **child category name**. Filters which child-category cards are returned. Matches the `title` field for video/material categories and the `name` field for exam categories (the response always exposes it as `title` either way). |

> No `page` / `limit` here — children are returned in full (a category's direct
> sub-folders are a small, bounded set). Use `search` to narrow the list.

### Response `200`

```jsonc
{
  "success": true,
  "data": {
    "parent": { "_id": "…", "title": "…", "image": "…" },
    "list": [
      {
        "category": {
          "_id": "…",
          "title": "…",                 // exam categories: aliased from `name`
          "image": "…",
          "havingChildDirectory": false, // true → drill again; false → open leaf list (§3)
          "count": 20                    // # leaf items directly under this child
        }
      }
    ]
  }
}
```

Recurse: each child again carries `havingChildDirectory` + `count`, so the FE
keeps drilling or opens the leaf list.

**Example**

```
GET /api/v1/client/material-categories/66f0.../children?search=gpsc
```

---

## 3. Leaf item lists — with SEARCH (EXISTING, reuse as-is)

Call when a tapped category has `havingChildDirectory: false`. **This is where
the per-tab search bar in the mockups lives.**

```
GET /api/v1/client/video-categories/:id/videos
GET /api/v1/client/material-categories/:id/materials
GET /api/v1/client/exam-categories/:id/exams
```

### Query params (all three)

| Param    | Type   | Default | Notes |
|----------|--------|---------|-------|
| `search` | string | `""`    | Case-insensitive substring match on item title. **Powers the "Search Test / Search Material / Search Subject,Videos" box.** |
| `page`   | number | `1`     | Pagination. |
| `limit`  | number | `20`    | Items per page. |

### Response `200`

```jsonc
{
  "success": true,
  "data": {
    "category": { "_id": "…", "title": "…", "image": "…" },
    "list": [ /* materials | exams | videos — see field notes below */ ]
  },
  "pagination": { "total": 11, "page": 1, "limit": 20, "totalPages": 1 }
}
```

- **Materials** rows: material doc (title, file/url, order, …).
- **Exams** rows: exam doc — render `title`, `questionCount`, `durationMinutes`
  → the "10 Questions | 10 Minutes" subtitle and the **Start** button (Start
  routes into the existing `/quizzes/:id/...` attempt flow).
- **Videos** rows: same metadata shape as §1 video rows, including `progress`,
  `recordings`, `qualities`, and `priceType` (Free/Paid pill).

---

## 4. Video playback (video only, EXISTING)

```
GET /api/v1/client/video-categories/:id/videos/:videoId
```

Returns the AES-encrypted multi-resolution envelope
(`data.request.files.{ token, hls, progressive }`). Decrypt with the existing
shared helper (identical to `/v1/lecture`). On a live-course paid video the user
isn't entitled to, expect `403` with `data.purchaseOptions`.

---

## 5. The "Videos filter" requirement (special to Videos)

> Requirement: on the **Videos** tab specifically, the FE wants to **filter the
> list down to a chosen subset of video categories** (e.g. show only "Reasoning"
> + "Maths" out of all subjects).

Supported on the **top-level videos** call via an optional repeatable
`categoryIds` filter:

```
GET /api/v1/client/catalog/:type/:id/videos?categoryIds=<catA>,<catB>
```

| Param         | Type                | Default        | Notes |
|---------------|---------------------|----------------|-------|
| `categoryIds` | comma-sep ObjectIds | _none_ (= all) | Restrict the returned `list` to these video categories only. Omit → all categories for the parent. Any id not belonging to this parent is ignored. |
| `search`      | string              | `""`           | Optional title search across the returned categories' videos. |

The response also returns the **full** set of available video categories under
`data.availableCategories` (id + title only) so the FE can render the
filter chooser / chips regardless of which subset is currently selected:

```jsonc
"availableCategories": [
  { "_id": "…", "title": "Reasoning - Krunal Sir" },
  { "_id": "…", "title": "Maths - Krunal Sir" }
]
```

> Materials and Tests do **not** need this filter (their flow is
> category-card → drill/leaf). It is video-only by design.

---

## Quick reference

| Screen (mockup)                          | Call |
|------------------------------------------|------|
| Course/Package/Live header stat counts   | `totals.items` from each of the 3 top-level calls (or the parent detail endpoint) |
| Videos tab (subject folder list)         | `GET /catalog/:type/:id/videos` |
| Videos tab — filter to chosen subjects   | `GET /catalog/:type/:id/videos?categoryIds=a,b` |
| Materials tab (category list)            | `GET /catalog/:type/:id/materials` |
| Test tab (category list)                 | `GET /catalog/:type/:id/tests` |
| Drill into a category w/ children        | `GET /{video|material|exam}-categories/:id/children?search=` |
| Material list + search                   | `GET /material-categories/:id/materials?search=` |
| Test list + search (Start button)        | `GET /exam-categories/:id/exams?search=` |
| Video list + search                      | `GET /video-categories/:id/videos?search=` |
| Play a video                             | `GET /video-categories/:id/videos/:videoId` |

---

## Error codes

| Code | When |
|------|------|
| `401` | Missing / invalid token. |
| `403` | Paid live-course video, viewer not subscribed (playback). Body carries `purchaseOptions`. |
| `404` | Parent (course/package/live-course) or category not found. |
| `422` | Invalid `type`, or malformed ObjectId in `id` / `categoryId` / `videoId`. |
| `500` | Server error. |
