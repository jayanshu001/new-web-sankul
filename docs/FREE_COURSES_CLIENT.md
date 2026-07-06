# Free Courses & Packages — Client API (Frontend Integration Doc)

A single endpoint that returns **recorded Courses and Packages together** in one
paginated list. It's **free by default**; pass `?type=paid` to get the paid set
instead. Every row is tagged with `kind` so the app knows whether it's a course
or a package.

---

## TL;DR

| | |
|---|---|
| **Endpoint** | `GET /api/v1/client/free-courses` |
| **Auth** | **Required** — `Authorization: Bearer <accessToken>` |
| **Default** | Free courses **and** packages, merged, newest-first |
| **Paid set** | `?type=paid` |
| **Row tag** | each item has `kind: "course"` or `kind: "package"` |
| **Paging** | `?page` / `?limit` over the **combined** total |
| **Search** | `?search=` matches name (both kinds) |

---

## 1. Query params

| Param | Default | Notes |
|-------|---------|-------|
| `type` | `free` | `free` → free only · `paid` → paid only · omit → free. Any other value treated as free. |
| `page` | `1` | 1-indexed. |
| `limit` | `20` | Page size over the merged list. |
| `search` | — | Case-insensitive match on course/package **name**. |

```
GET /api/v1/client/free-courses                  → free courses + packages (default)
GET /api/v1/client/free-courses?type=paid        → paid courses + packages
GET /api/v1/client/free-courses?type=free         → free (explicit, same as default)
GET /api/v1/client/free-courses?page=2&limit=10  → page 2
GET /api/v1/client/free-courses?search=upsc       → name contains "upsc"
```

### Auth — REQUIRED

```
Authorization: Bearer <accessToken>
```

Missing/invalid/expired token → `401`. Same refresh+retry flow as every other
client endpoint.

---

## 2. Response

`200 OK` — `data` is a **flat array** of mixed courses and packages
(newest-first), with top-level `pagination`:

```jsonc
{
  "success": true,
  "data": [
    {
      "kind": "package",
      "_id": "665f...",
      "name": "UPSC GS Foundation",
      "description": "...",
      "image": "https://cdn.example.com/...",
      "isPaid": false,
      "packageTypeId": { "_id": "...", "name": "Foundation" },
      "goalId": { "_id": "...", "title": "UPSC" },
      "isSmartCourse": false,
      "isPlannerCourse": false,
      "plans": {
        "withMaterial":    [ { "_id": "...", "name": "6 months", "duration": 180, "price": 0, "withMaterial": true,  "isDefault": true } ],
        "withoutMaterial": [ { "_id": "...", "name": "6 months", "duration": 180, "price": 0, "withMaterial": false, "isDefault": false } ]
      },
      "subscriberCount": 1240,
      "isPurchased": false,
      "daysLeft": null,
      "shareableLink": "https://.../share/packages/665f...",
      "createdAt": "2026-05-30T10:00:00.000Z",
      "updatedAt": "2026-06-01T06:05:38.233Z"
    },
    {
      "kind": "course",
      "_id": "664a...",
      "name": "Polity Crash Course",
      "description": "...",
      "image": "https://cdn.example.com/...",
      "level": "Beginner",
      "isPaid": false,
      "courseEducatorId": { "_id": "...", "name": "..." },
      "courseSubjectCategoryId": { "_id": "...", "title": "Polity" },
      "videoCategoryId": { "_id": "...", "title": "..." },
      "plans": {
        "withMaterial":    [ /* PackageCourseEbookPrice rows */ ],
        "withoutMaterial": [ /* ... */ ]
      },
      "isPurchased": false,
      "daysLeft": null,
      "shareableLink": "https://.../share/courses/664a...",
      "createdAt": "2026-05-28T10:00:00.000Z",
      "updatedAt": "2026-05-29T10:00:00.000Z"
    }
  ],
  "pagination": { "total": 12, "page": 1, "limit": 20, "totalPages": 1 }
}
```

### `kind` — the discriminator

Each row carries **`kind`**:

- `"course"` → a recorded Course. Open via your course detail flow
  (`/client/courses/:id`).
- `"package"` → a Package. Open via your package detail flow
  (`/client/packages/:id`).

Always branch on `kind` — don't infer from other fields.

---

## 3. Field reference

**Common to both kinds:**

| Field | Type | Notes |
|-------|------|-------|
| `kind` | `"course" \| "package"` | Discriminator. |
| `_id` | string | Product id (use for the detail call, keyed by `kind`). |
| `name` | string | Title. |
| `description` | string | |
| `image` | string | Hosted URL. |
| `isPaid` | boolean | `false` for the free set, `true` for the paid set. |
| `plans` | object | `{ withMaterial: [], withoutMaterial: [] }` — pricing tiers (same shape as the dedicated course/package lists). Empty arrays if none. |
| `isPurchased` | boolean | True if the logged-in user has an active subscription. |
| `daysLeft` | number \| null | Days remaining on the active sub; `null` = lifetime **or** not purchased (check `isPurchased`). |
| `shareableLink` | string | Deep-share URL. |
| `createdAt` / `updatedAt` | ISO string | `createdAt` drives the merged newest-first order. |

**Package-only:** `packageTypeId`, `goalId`, `isSmartCourse`, `isPlannerCourse`,
`subscriberCount`.
**Course-only:** `level`, `courseEducatorId`, `courseSubjectCategoryId`,
`videoCategoryId`.

> The `plans` rows are `PackageCourseEbookPrice` documents: `name`, `duration`
> (days), `price`, `withMaterial`, `materialPrice`, `isDefault`, etc. For free
> products these typically have `price: 0`. To show a "starting price" badge,
> pick the `isDefault` plan (or the cheapest).

---

## 4. Paging note (important)

`data` is a **merged** list of two collections, paginated **after** merging:

- `pagination.total` = total free (or paid) **courses + packages** combined.
- A single page can contain a mix of both `kind`s.
- Ordering is **newest-first by `createdAt`** across both kinds, stable across
  pages — so infinite scroll / page-by-page works normally.

---

## 5. Integration example (TypeScript / fetch)

```ts
type Kind = "course" | "package";

interface ProductRow {
  kind: Kind;
  _id: string;
  name: string;
  image: string;
  isPaid: boolean;
  isPurchased: boolean;
  daysLeft: number | null;
  plans: { withMaterial: any[]; withoutMaterial: any[] };
  shareableLink: string;
  // ...kind-specific fields
}

export async function getFreeCourses(
  accessToken: string,
  opts: { type?: "free" | "paid"; page?: number; limit?: number; search?: string } = {}
): Promise<{ data: ProductRow[]; pagination: { total: number; page: number; limit: number; totalPages: number } }> {
  const qs = new URLSearchParams();
  if (opts.type) qs.set("type", opts.type);
  if (opts.page != null) qs.set("page", String(opts.page));
  if (opts.limit != null) qs.set("limit", String(opts.limit));
  if (opts.search) qs.set("search", opts.search);

  const res = await fetch(`${API_BASE}/api/v1/client/free-courses?${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED"); // trigger refresh
  const json = await res.json();
  if (!json.success) throw new Error(json.message ?? "Failed to load");
  return json;
}

// Routing on tap:
function openProduct(row: ProductRow) {
  return row.kind === "course"
    ? navigate(`/courses/${row._id}`)
    : navigate(`/packages/${row._id}`);
}
```

### React Query hook

```ts
export const useFreeCourses = (
  opts: { type?: "free" | "paid"; page?: number; search?: string } = {}
) =>
  useQuery({
    queryKey: ["free-courses", opts],
    queryFn: () => getFreeCourses(getAccessToken(), opts),
    keepPreviousData: true,
  });
```

---

## 6. Checklist for the app

- [ ] Send `Authorization: Bearer <accessToken>` (required).
- [ ] Call with no `type` for the **free** list; pass `?type=paid` for the paid
      list.
- [ ] Read rows from **`data`** (flat array); page with top-level `pagination`.
- [ ] Branch on **`kind`** to render and to route to the right detail screen
      (`/courses/:id` vs `/packages/:id`).
- [ ] Use `plans` for pricing; show "Free" when `isPaid === false`.
- [ ] Use `isPurchased` / `daysLeft` for the owned badge (remember `daysLeft:
      null` + `isPurchased: true` = lifetime).
- [ ] Optional `?search=` filters by name across both kinds.
```
