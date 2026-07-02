# Notification Deep-Linking — Admin Send Contract

How the admin panel selects a tap destination when sending a push, and how the
backend turns that selection into the FCM `data` fields the mobile app reads.

Source of truth for the app side:
[`notification-tap-payload.md`](./notification-tap-payload.md) (the RN spec).
Backend implementation:

| File | Responsibility |
|---|---|
| `src/utils/notificationTarget.ts` | Semantic `target` schema + `buildNotificationRouting()` |
| `src/admin/notification/notification.controller.ts` | `broadcast` endpoint — resolves `target` → `deepLink` + `data` |
| `src/utils/fcm.ts` | `buildMessage()` — puts `deepLink` + all `data` keys into the FCM `data` block |
| `src/modules/admin-notification/admin-notification.service.ts` | `searchTargetOptions()` — powers the panel's searchable item dropdown |

> **Frontend surface note.** The admin panel exposes only **two** actions —
> *In-App Screen* (`content` target, or *Other* = no target) and *Open External
> Link* (`external` target) — and no channel field. The other `target` kinds
> (`appPath` / `screen` / `deepLink` / `dialog`) and `channelId` remain valid on
> the API for internal/automated senders. See
> [`ADMIN_PANEL_NOTIFICATION_GUIDE.md`](./ADMIN_PANEL_NOTIFICATION_GUIDE.md).

---

## 1. The key idea

The **admin panel does not build deep-link strings**. It sends a *semantic
selection* (`target`), and the backend produces the exact wire fields
(`deepLink`, `viewType`, `screen`, `params`, `channelId`) the app expects.

This guarantees:

- Every routing field lands in FCM `data` (never only in `notification`), so taps
  always navigate.
- Every `data` value is a **string**; `params` is JSON-encoded.
- Content ids are numeric SQL primary keys carried as text in the path.

Resolution happens once, at the controller boundary. Immediate sends, scheduled
sends (re-dispatched later by the BullMQ worker), the per-recipient feed rows,
and FCM all keep reading plain `deepLink` + `data` — nothing else changed.

---

## 2. Endpoint

`POST /api/v1/admin/notifications/broadcast` (Bearer, `admin`/`super_admin`).
`multipart/form-data` when uploading an `image`, else JSON.

```jsonc
{
  "title": "New Test Series",
  "body": "GPSC Prelims Mock #5 is live",
  "type": "general",                 // optional log category
  "channelId": "websankul-offer",    // optional Android channel
  "target": { "kind": "content", "entity": "test-series", "id": 1024 },

  // audience (all optional; omit everything = broadcast to all devices)
  "platforms": ["android", "ios"],
  "courseIds": ["42"],
  "userIds": ["1001", "1002"],
  "scheduledAt": "2026-07-05T09:30:00.000Z"  // omit = send now
}
```

`image` is set from the uploaded file (field name `image`) or a URL in the body.

---

## 3. `target` — the six selection kinds

Discriminated on `kind`. Pick one; the panel renders one field-set per kind.

| `kind` | Fields | Produces | When to use |
|---|---|---|---|
| `content` | `entity`, `id` | `deepLink: <scheme>://<entity>/<id>` | **Default** — open a content detail screen |
| `appPath` | `path` | `deepLink: <scheme>://<path>` | Open a tab / parameter-less screen |
| `deepLink` | `url` | `deepLink: <url>` | Paste a ready-made deep-link or share URL |
| `screen` | `screen`, `params?` | `data.screen` (+ `data.params` JSON) | Route by RN screen name with params |
| `external` | `url` | `data.viewType:"link"` + `deepLink:<url>` | Open a website / WhatsApp outside the app |
| `dialog` | — | `data.viewType:"dialog"` | Acknowledge tap, no navigation |

`<scheme>` = `APP_SCHEME` (default `com.gpscvideo.gpsc`).

### 3.1 `content` entities → path (spec §4)

| `entity` | Path | App screen |
|---|---|---|
| `course` | `course/<id>` | Subject |
| `package` | `package/<id>` | CourseMaterial |
| `live-course` | `live-course/<id>` | LiveCourseMaterial |
| `book` | `book/<id>` | LibraryBookDetails |
| `ebook` | `ebook/<id>` | LibraryEBookDetails |
| `test-series` | `test-series/<id>` | TestSeriesDetails |

`id` accepts a number or numeric string; it must be a **SQL integer PK**.

### 3.2 `appPath` values

`home` · `library` · `profile` · `tests` · `notes` · `notifications`

### 3.3 `channelId` (Android channel, spec §3.1)

`websankul-default` (default) · `websankul-social` · `websankul-offer`

---

## 4. Examples (request `target` → resulting FCM `data`)

**Open a course**
```jsonc
"target": { "kind": "content", "entity": "course", "id": 42 }
// → data: { "deepLink": "com.gpscvideo.gpsc://course/42" }
```

**Open the notifications tab**
```jsonc
"target": { "kind": "appPath", "path": "notifications" }
// → data: { "deepLink": "com.gpscvideo.gpsc://notifications" }
```

**Screen + params (no URL)**
```jsonc
"target": { "kind": "screen", "screen": "TestSeriesDetails", "params": { "seriesId": 1024 } }
// → data: { "screen": "TestSeriesDetails", "params": "{\"seriesId\":1024}" }
```

**External website**
```jsonc
"target": { "kind": "external", "url": "https://websankul.com/refer-and-earn" }
// → data: { "viewType": "link", "deepLink": "https://websankul.com/refer-and-earn" }
```

**Offer with image + channel**
```jsonc
{
  "title": "50% off Test Series",
  "body": "Limited time offer",
  "image": "https://cdn.websankul.com/offers/50off.jpg",
  "channelId": "websankul-offer",
  "target": { "kind": "content", "entity": "test-series", "id": 1024 }
}
// → data: { "deepLink": "com.gpscvideo.gpsc://test-series/1024", "channelId": "websankul-offer" }
```

---

## 5. Backward compatibility / escape hatch

The old freeform fields still work:

- `deepLink: "<string>"` — sent as-is.
- `data: { ...arbitrary string-able keys }` — merged into FCM `data`.

If both `target` and freeform fields are present, **`target` wins** on conflicting
keys so the app-routing contract can't be broken by a stale hand-typed value.
Prefer `target` for all new panel work.

---

## 6. Admin-panel UI (as shipped)

An "Action type" selector with **two** options next to the title/body/image fields:

- **In-App Screen** → **Entity** dropdown
  (course / package / live-course / book / ebook / test-series / **Other**):
  - a content entity → a **searchable dropdown** sourced from
    `GET /api/v1/admin/notifications/target-options?entity=&q=&page=&limit=`; the
    picked item's numeric id → `target: { kind:"content", entity, id }`.
  - **Other** → no further field; **omit `target`** (the app just opens).
- **Open External Link** → **URL** input → `target: { kind:"external", url }`.

No channel field is shown. The panel submits the chosen `target` verbatim — no
string building on the client. Full frontend spec:
[`ADMIN_PANEL_NOTIFICATION_GUIDE.md`](./ADMIN_PANEL_NOTIFICATION_GUIDE.md).

### `target-options` endpoint

`GET /api/v1/admin/notifications/target-options` (Bearer, `admin`/`super_admin`).
Query: `entity` (required, one of the six content entities), `q` (search),
`page` (default 1), `limit` (default 20, max 50). Label field per entity:
`test-series` → `title`, the rest → `name`. Response:

```jsonc
{ "success": true,
  "data": [ { "id": 42, "label": "GPSC Prelims Foundation" } ],
  "pagination": { "total": 1, "page": 1, "limit": 20, "totalPages": 1 } }
```

> Validation errors return `400 { success:false, errors:[...] }` (Zod issues), so
> the panel can surface field-level messages.
