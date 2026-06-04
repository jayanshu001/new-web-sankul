# Free Current Affairs — Client API (Frontend Integration Doc)

Backend for the **Free Current Affairs** home-screen block is live. This doc is
for the **client app / frontend** team. It covers the one endpoint the app
needs, the exact response shape, auth, and a ready-to-use integration snippet.

> Admin CRUD (create/edit/delete from the dashboard) is separate and documented
> at the bottom for reference — the app only consumes the client endpoint.

---

## TL;DR

| | |
|---|---|
| **Endpoint** | `GET /api/v1/client/current-affairs` |
| **Auth** | **Required** — `Authorization: Bearer <accessToken>` |
| **Returns** | Active items only, newest first |
| **Fields** | `_id`, `title`, `image`, `youtubeLink` |
| **Pagination** | None. Optional `?limit=N` to cap the list |

---

## 1. Endpoint

```
GET /api/v1/client/current-affairs
GET /api/v1/client/current-affairs?limit=10
```

- Returns **only** items with `status: true` (Active). Inactive items are never
  sent to the client.
- Sorted by `createdAt` **descending** (newest first).
- No pagination. Pass `?limit=N` (positive integer) if you want to cap how many
  are returned; omit it (or `limit=0`) to get the full active list.

### Auth — REQUIRED

Every client route in this backend requires a logged-in user. Send the standard
access token:

```
Authorization: Bearer <accessToken>
```

A missing/invalid/expired token returns `401`. Refresh + retry using the same
flow as every other client endpoint (banners, popup, faqs, etc.) — there is
nothing special here.

---

## 2. Response shape

**`200 OK`**

```json
{
  "success": true,
  "data": [
    {
      "_id": "665f0c2a9b1e4a0012a3b4c5",
      "title": "UPSC GS 2026 Complete Course",
      "image": "https://cdn.example.com/current-affairs/abc.jpg",
      "youtubeLink": "https://www.youtube.com/watch?v=XXXXXXXXXXX"
    },
    {
      "_id": "665f0c2a9b1e4a0012a3b4c6",
      "title": "Daily Current Affairs — June",
      "image": "https://cdn.example.com/current-affairs/def.jpg",
      "youtubeLink": "https://youtu.be/YYYYYYYYYYY"
    }
  ]
}
```

> ⚠️ **Important — the array is under `data` directly** (an array), **not**
> `data.items`. This matches every other client CMS endpoint in this backend
> (banners, testimonials, social-links, …). The spec draft mentioned
> `data.items`, but we intentionally followed the existing project convention so
> all client list endpoints behave identically.

When there are no active items:

```json
{ "success": true, "data": [] }
```

Always an array — render an empty state, no special-casing needed.

**Error (`500`)**

```json
{ "success": false, "message": "<error message>" }
```

`401` (auth) has the standard auth-failure body used across the app.

---

## 3. Field reference

| Field         | Type   | Notes                                                        |
|---------------|--------|--------------------------------------------------------------|
| `_id`         | string | Mongo ObjectId. Use as the list key.                         |
| `title`       | string | Max 255 chars.                                               |
| `image`       | string | Hosted S3/CDN URL — load directly into an `<Image>`.         |
| `youtubeLink` | string | A YouTube watch / embed / shorts / live URL (see §4).        |

`status`, `createdAt`, `updatedAt` are **not** returned to the client (only the
three fields the home screen renders). Every record is guaranteed to have
`title`, `image`, and `youtubeLink`.

---

## 4. Handling `youtubeLink`

The link can come in any YouTube format the admin pasted:

- `https://www.youtube.com/watch?v=XXXXXXXXXXX`
- `https://youtu.be/XXXXXXXXXXX`
- `https://www.youtube.com/shorts/XXXXXXXXXXX`
- `https://www.youtube.com/embed/XXXXXXXXXXX`
- `https://www.youtube.com/live/XXXXXXXXXXX`

There is **no detail screen and no "View All"** — items render inline on the
home screen. On tap, either open the link externally or play inline. To play
inline you'll usually need the 11-char video id; a small extractor:

```ts
export function youtubeId(url: string): string | null {
  const m = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/
  );
  return m ? m[1] : null;
}
// thumbnail fallback: https://img.youtube.com/vi/<id>/hqdefault.jpg
```

(Use the `image` field as the card thumbnail; the YouTube thumbnail is only a
fallback if you ever need one.)

---

## 5. Integration example (TypeScript / fetch)

```ts
export interface CurrentAffair {
  _id: string;
  title: string;
  image: string;
  youtubeLink: string;
}

export async function getCurrentAffairs(
  accessToken: string,
  limit?: number
): Promise<CurrentAffair[]> {
  const qs = limit && limit > 0 ? `?limit=${limit}` : "";
  const res = await fetch(`${API_BASE}/api/v1/client/current-affairs${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 401) throw new Error("UNAUTHORIZED"); // trigger refresh
  const json = await res.json();
  if (!json.success) throw new Error(json.message ?? "Failed to load");

  return json.data as CurrentAffair[]; // array directly under `data`
}
```

### React Query hook

```ts
export const useCurrentAffairs = (limit?: number) =>
  useQuery({
    queryKey: ["current-affairs", limit ?? null],
    queryFn: () => getCurrentAffairs(getAccessToken(), limit),
    staleTime: 5 * 60 * 1000,
  });
```

---

## 6. Checklist for the app

- [ ] Call `GET /api/v1/client/current-affairs` on home-screen load.
- [ ] Send `Authorization: Bearer <accessToken>` (required).
- [ ] Read the array from `response.data` (it's the array itself, not
      `data.items`).
- [ ] Render `image` as the card, `title` as the label.
- [ ] On tap, open / play `youtubeLink` (use the extractor in §4 for inline).
- [ ] Empty list → show empty state (no error).
- [ ] No "View All" screen, no detail page — render inline only.
- [ ] (Optional) pass `?limit=N` if the home block should cap the count.

---

## Appendix — Admin endpoints (FYI, not used by the app)

Base path: `/api/v1/admin/cms/current-affairs` · all require **admin** auth
(`Authorization: Bearer <adminToken>` with role `admin`/`super_admin`).

| Method   | Path                                       | Purpose          | Body                              |
|----------|--------------------------------------------|------------------|-----------------------------------|
| `GET`    | `/api/v1/admin/cms/current-affairs`        | List all         | —                                 |
| `GET`    | `/api/v1/admin/cms/current-affairs/:id`    | Get one          | —                                 |
| `POST`   | `/api/v1/admin/cms/current-affairs`        | Create           | `multipart/form-data`             |
| `PUT`    | `/api/v1/admin/cms/current-affairs/:id`    | Update           | `multipart/form-data` **or** JSON |
| `DELETE` | `/api/v1/admin/cms/current-affairs/:id`    | Delete           | —                                 |

- **Image field name** is `image` (multipart file), same as Banners/Popups.
- **Create** requires `image` + `title` + `youtubeLink`; `status` optional
  (string `"true"`/`"false"` or boolean).
- **Update**: if a new `image` file is sent → it's replaced; if the admin
  doesn't change the image, send a JSON body with just `title` / `youtubeLink` /
  `status` and **no `image`** — the backend keeps the existing image URL.
- Admin list returns the full array under `data` (no pagination), consistent
  with the other admin CMS resources.
