# Admin Panel — Sending Notifications with Deep Links (Frontend Guide)

**Audience:** Admin panel frontend developer.
**TL;DR:** When sending a push, the panel picks a **destination** (what opens when
the user taps). The panel sends a small JSON object called `target` — it does
**not** build any URL/deep-link string itself. The backend converts `target` into
the correct payload the mobile app needs.

There are only **two action types**: *In-App Screen* and *Open External Link*.

---

## 1. Endpoints

### Send / schedule a notification
```
POST /api/v1/admin/notifications/broadcast
Authorization: Bearer <admin token>
```
- Send as **JSON** normally (`target` is a real object).
- Send as **multipart/form-data** only when uploading an image file (field name `image`).
  In multipart, **every field is a string**, so JSON-encode object/array fields —
  `target`, and if used `data` / `platforms` / `courseIds` / `userIds`. The backend
  decodes them automatically. Example: `target = {"kind":"external","url":"https://…"}`
  as a string field.

### Searchable dropdown source (for In-App Screen items)
```
GET /api/v1/admin/notifications/target-options?entity=<entity>&q=<search>&page=1&limit=20
Authorization: Bearer <admin token>
```
Returns the list to populate the item dropdown for the selected entity. See §4.

---

## 2. The UI: an "Action" selector

Add an **Action** section to the send form (next to title / body / image):

1. **Action type** dropdown — only two options:
   - **In-App Screen** → opens something inside the app
   - **Open External Link** → opens a URL outside the app (browser / WhatsApp / …)
2. Fields that appear depend on the choice (below).

> There is **no channel field** in the panel. Leave it out.

### Action = "In-App Screen"

Show an **Entity** dropdown:

`Course` · `Package` · `Live Course` · `Book` · `E-Book` · `Test Series` · **`Other`**

- If a **content entity** is chosen (anything except *Other*):
  show a **searchable dropdown** whose options come from the
  `GET /target-options` endpoint (§4). The admin searches and picks an item; you
  capture its **numeric `id`**.
  → send `target: { "kind": "content", "entity": <entity>, "id": <id> }`
- If **`Other`** is chosen:
  show **no further fields**.
  → send `target: { "kind": "dialog" }`.
  The client receives `data: { "viewType": "dialog" }` — a unique marker so the
  app can recognise a general/"Other" notification (no content navigation).

### Action = "Open External Link"

Show a **URL** input (validate it's a full `https://…` URL).
→ send `target: { "kind": "external", "url": "<url>" }`

---

## 3. Request body

```jsonc
{
  "title": "New Test Series",              // required
  "body":  "GPSC Prelims Mock #5 is live", // required

  "target": { ... },                       // omit entirely for entity = "Other"
  "image": "https://.../banner.jpg",       // optional (or upload file field "image")

  // Audience — omit ALL of these = send to everyone
  "platforms": ["android", "ios"],         // optional
  "courseIds": ["42"],                     // optional — subscribers of these courses
  "userIds":   ["1001", "1002"],           // optional — specific customers

  "scheduledAt": "2026-07-05T09:30:00.000Z" // optional — omit = send now
}
```

`target` is one of exactly these three shapes:

| Situation | `target` to send |
|---|---|
| In-App Screen + a content entity | `{ "kind": "content", "entity": "course", "id": 42 }` |
| In-App Screen + **Other** | `{ "kind": "dialog" }` → client gets `data: { "viewType": "dialog" }` |
| Open External Link | `{ "kind": "external", "url": "https://…" }` |

Allowed `entity` values: `course`, `package`, `live-course`, `book`, `ebook`,
`test-series`.

### Response
```jsonc
// success
{ "success": true, "message": "Notification sent.", "data": { ... } }
// validation error (show field messages)
{ "success": false, "errors": [ /* Zod issues */ ] }
```

---

## 4. Item dropdown — `GET /target-options`

Use this to fill the searchable item dropdown after an entity is picked.

**Request**
```
GET /api/v1/admin/notifications/target-options?entity=course&q=gpsc&page=1&limit=20
```

| Query param | Required | Notes |
|---|---|---|
| `entity` | **Yes** | one of `course` `package` `live-course` `book` `ebook` `test-series` |
| `q` | No | search text (matches the item name/title, server-side) |
| `page` | No | default `1` |
| `limit` | No | default `20`, max `50` |

**Response**
```jsonc
{
  "success": true,
  "data": [
    { "id": 42, "label": "GPSC Prelims Foundation" },
    { "id": 88, "label": "GPSC Mains Booster" }
  ],
  "pagination": { "total": 2, "page": 1, "limit": 20, "totalPages": 1 }
}
```

Wire it as a typeahead: debounce the search box → call with `q` → show `label`,
store `id`. Put the chosen `id` into the `content` target. Paginate with `page`
for long lists.

---

## 5. Full copy-paste examples

**In-App Screen → a course (id picked from the dropdown)**
```json
{
  "title": "New lectures added",
  "body": "5 new videos in your course",
  "target": { "kind": "content", "entity": "course", "id": 42 }
}
```

**In-App Screen → a test series, with an image, everyone**
```json
{
  "title": "50% off Test Series",
  "body": "Limited time offer",
  "image": "https://cdn.websankul.com/offers/50off.jpg",
  "target": { "kind": "content", "entity": "test-series", "id": 1024 }
}
```

**In-App Screen → Other (general notification, no content navigation)**
```json
{
  "title": "Welcome back",
  "body": "Check out what's new",
  "target": { "kind": "dialog" }
}
```
Client receives `data: { "viewType": "dialog" }`.

**Open External Link**
```json
{
  "title": "Refer & Earn",
  "body": "Share and earn rewards",
  "target": { "kind": "external", "url": "https://websankul.com/refer-and-earn" }
}
```

**Scheduled, only Android subscribers of course 42, opens a live course**
```json
{
  "title": "Class reminder",
  "body": "Live session starts at 6 PM",
  "target": { "kind": "content", "entity": "live-course", "id": 15 },
  "platforms": ["android"],
  "courseIds": ["42"],
  "scheduledAt": "2026-07-05T12:30:00.000Z"
}
```

---

## 6. Rules / gotchas

- **Only two actions:** In-App Screen and Open External Link. No channel field.
- **Never build deep-link strings on the frontend.** Send `target`; the backend
  builds the wire payload.
- **`id` comes from `/target-options`**, not manual entry. Store the numeric `id`.
- **Entity = Other → `target: { "kind": "dialog" }`.** No item dropdown, no URL;
  the client receives `data: { "viewType": "dialog" }` to recognise a general push.
- **External link** must be a full `https://…` URL.
- Omit **all** audience fields to broadcast to everyone. Any of `platforms`,
  `courseIds`, `userIds` narrows the audience.
- `scheduledAt` must be in the **future** (ISO 8601). Omit to send immediately.
- On `400`, read `errors[]` (Zod issues) to show field-level messages.

Questions on the API → backend team.
