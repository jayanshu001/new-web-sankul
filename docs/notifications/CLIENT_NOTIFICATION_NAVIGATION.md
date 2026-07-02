# Client (Mobile App) — Notification Payloads & Navigation

**Audience:** React Native app developer.
**Purpose:** The exact FCM message the device receives for every kind of
notification the backend sends, and the navigation the app should perform for
each. Use this to implement / verify tap routing.

> All routing lives in the FCM **`data`** block (never in `notification`). Every
> `data` value is a **string**. Read routing fields from `data` only.

---

## 1. Routing decision (first match wins)

Apply these rules in order to the `data` block:

| # | Condition in `data` | Action |
|---|---|---|
| 1 | `viewType === "link"` AND (`deepLink` or `clickAction`) | Open URL **externally** (`Linking.openURL`) |
| 2 | `viewType === "dialog"` | **No navigation** — general/"Other" push (see §7) |
| 3 | `screen` present | `navigate(screen, JSON.parse(params ?? "{}"))` |
| 4 | `deepLink` or `clickAction` present | **In-app** deep-link navigation (§6) |
| 5 | none of the above | Just open the app (no navigation) |

`image` (if present) is the big-picture/attachment. `channelId` (if present) is the
Android channel — display only, never routing.

---

## 2. Envelope you receive

Every message looks like the sample below; only the **`notification`** and
**`data`** blocks are set by our backend. The rest (`from`, `messageId`,
`sentTime`, `ttl`, `priority`, `collapseKey`, `android`) are added by FCM — **do
not** use them for routing.

```jsonc
{
  "notification": { "title": "…", "body": "…" },   // shown in the status bar
  "data": { /* ← ALL routing fields live here */ },
  "from": "625273640843",
  "messageId": "0:1782989728531406%…",
  "sentTime": 1782989728525,
  "ttl": 2419200,
  "priority": 2,
  "collapseKey": "com.gpscvideo.gpsc"
}
```

The sections below show only the **`notification` + `data`** the backend emits
(the FCM metadata is always appended as above).

---

## 3. In-App Screen → content (Course / Package / Live Course / Book / E-Book / Test Series)

`data.deepLink` = `com.gpscvideo.gpsc://<path>/<id>`. **Rule 4** → in-app nav.

| Entity | `data.deepLink` | Navigate to | Param |
|---|---|---|---|
| Course | `com.gpscvideo.gpsc://course/<id>` | `Subject` | `courseId` |
| Package | `com.gpscvideo.gpsc://package/<id>` | `CourseMaterial` | `courseId` + `isPackage:true` |
| Live Course | `com.gpscvideo.gpsc://live-course/<id>` | `LiveCourseMaterial` | `liveCourseId` |
| Book | `com.gpscvideo.gpsc://book/<id>` | `LibraryBookDetails` | `bookId` |
| E-Book | `com.gpscvideo.gpsc://ebook/<id>` | `LibraryEBookDetails` | `bookId` |
| Test Series | `com.gpscvideo.gpsc://test-series/<id>` | `TestSeriesDetails` | `seriesId` |

**Example — Course 114**
```jsonc
{
  "notification": { "title": "New lectures added", "body": "5 new videos in your course" },
  "data": { "deepLink": "com.gpscvideo.gpsc://course/114" }
}
```
→ `navigate("Subject", { courseId: 114 })`

**Example — Test Series 1024 (with image)**
```jsonc
{
  "notification": { "title": "50% off Test Series", "body": "Limited time offer" },
  "data": { "deepLink": "com.gpscvideo.gpsc://test-series/1024" }
}
```
→ `navigate("TestSeriesDetails", { seriesId: 1024 })`

> `<id>` is always a **numeric SQL id** (integer), carried as text in the path.

---

## 4. Open External Link

`data.viewType === "link"` + `data.deepLink` = full URL. **Rule 1** → open
**externally** with `Linking.openURL`, do NOT navigate in-app.

```jsonc
{
  "notification": { "title": "New video is live", "body": "Watch now on YouTube" },
  "data": {
    "viewType": "link",
    "deepLink": "https://www.youtube.com/watch?v=bghRKnP9zq0"
  }
}
```
→ `Linking.openURL("https://www.youtube.com/watch?v=bghRKnP9zq0")`

External links open **regardless of login state**.

---

## 5. In-App Screen → Other (general notification)

`data.viewType === "dialog"`. **Rule 2** → **no content navigation**. This is the
unique marker for a general/"Other" push. Handle as you wish (e.g. toast, open the
Notifications list, or nothing).

```jsonc
{
  "notification": { "title": "Welcome back", "body": "Check out what's new" },
  "data": { "viewType": "dialog" }
}
```
→ no navigation (or your chosen default). See §7.

---

## 6. Accepted deep-link URL forms (Rule 4)

Normalise all of these before routing:

- `com.gpscvideo.gpsc://<path>/<id>` (primary — what the backend sends)
- Share URLs → map segment → in-app path:
  | Share path | In-app path |
  |---|---|
  | `/share/courses/<id>` | `course/<id>` |
  | `/share/packages/<id>` | `package/<id>` |
  | `/share/live-courses/<id>` | `live-course/<id>` |
  | `/share/books/<id>` | `book/<id>` |
  | `/share/ebooks/<id>` | `ebook/<id>` |
  | `/share/test-series/<id>` | `test-series/<id>` |
- Parameter-less paths: `home`, `library`, `profile`, `tests`, `notes`,
  `notifications` (e.g. `com.gpscvideo.gpsc://notifications`).

> The admin panel currently only emits the two active cases (**content** in §3 and
> **external** in §4) plus **Other** (§5). The forms here (share URLs,
> parameter-less paths, `screen`+`params`) are also supported by the backend for
> internal/automated senders — implement them so any of them route correctly.

---

## 7. Auth & timing

- If the user is **not logged in** when an in-app deep link arrives, **queue** it
  and replay after login (`replayPendingDeepLink`).
- Retry navigation until the navigator is ready and past auth screens
  (`Splash`/`Login`/`OTP`) — up to ~6 s.
- In-app destinations require login; **external** (`viewType:"link"`) links open
  regardless.

---

## 8. Quick reference — what to branch on

```ts
const d = message.data ?? {};

if (d.viewType === "link" && (d.deepLink || d.clickAction)) {
  Linking.openURL(d.deepLink || d.clickAction);           // §4 external
} else if (d.viewType === "dialog") {
  handleGeneralNotification();                             // §5 Other — no nav
} else if (d.screen) {
  navigate(d.screen, d.params ? JSON.parse(d.params) : {});// screen + params
} else if (d.deepLink || d.clickAction) {
  routeDeepLink(d.deepLink || d.clickAction);              // §3/§6 in-app
} else {
  /* just open the app */
}
```

Fields summary:

| `data` field | Meaning | Type |
|---|---|---|
| `deepLink` | Target URL/path (in-app or, with `viewType:link`, external) | string |
| `viewType` | `"link"` (external) or `"dialog"` (general, no nav) | string |
| `screen` | React-Navigation screen name | string |
| `params` | Nav params for `screen` | JSON string |
| `clickAction` | Legacy alias for `deepLink` | string |
| `channelId` | Android channel (display only) | string |
| `image` | Big-picture/attachment (also `notification` image) | string (URL) |
