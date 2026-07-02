# Notification Tap Payload — Backend & FCM Spec

> **Audience:** Backend / DevOps sending Firebase Cloud Messaging (FCM) pushes to Websankul.  
> **Covers:** What happens when a user taps a notification in the device status bar (Android shade / iOS Notification Center).

---

## 1. How tap routing works in the app

Websankul uses **Firebase Messaging** for delivery and **Notifee** to display notifications when the app is in the foreground.

On status-bar tap, the app reads routing fields from the FCM **`data`** payload (not from `notification.title` / `notification.body`). Handlers involved:

| App state | Handler | Source file |
|---|---|---|
| Killed (cold start) | `messaging().getInitialNotification()` | `src/helpers/notificationHandler.ts` → `getInitialNotificationBg` |
| Background → foreground | `messaging().onNotificationOpenedApp()` | `notificationOpenedAppHandler` |
| Foreground (Notifee banner) | `notifee.onForegroundEvent(PRESS)` | `notifeeActionHandler` + `useDeepLinkController` |

**Routing priority** (first match wins):

1. `viewType === "link"` + (`deepLink` or `clickAction`) → open URL in browser / external app
2. `viewType === "dialog"` → no navigation (placeholder)
3. `screen` present → `navigationRef.navigate(screen, params)`
4. `deepLink` or `clickAction` present → in-app deep link navigation

---

## 2. FCM payload shape

### 2.1 Required structure

```json
{
  "notification": {
    "title": "New test series available",
    "body": "Tap to view details"
  },
  "data": {
    "deepLink": "com.gpscvideo.gpsc://test-series/1024"
  }
}
```

| Block | Required | Purpose |
|---|---|---|
| `notification` | Recommended | OS displays title/body in status bar when app is backgrounded/killed |
| `data` | **Required for tap routing** | All navigation fields live here |

> **Important:** If routing fields exist only in `notification` and not in `data`, the tap will open the app but **will not navigate anywhere**.

### 2.2 FCM `data` value rules

Firebase requires every key in `data` to be a **string**.

| Field | Type in `data` | Notes |
|---|---|---|
| `deepLink`, `clickAction`, `viewType`, `screen`, `channelId`, `image`, `title`, `body` | string | Plain strings |
| `params` | string | **JSON-encoded object**, e.g. `"{\"courseId\":42}"` |

### 2.3 Entity IDs (SQL)

All content IDs (`course`, `package`, `book`, `ebook`, `live-course`, `test-series`) are **SQL integer primary keys** (e.g. `42`, `88`, `1024`).

- In **deep-link URLs**, the ID is the numeric segment: `com.gpscvideo.gpsc://course/42`
- In FCM `data`, every value must still be a **string** — the URL/path carries the number as text (`"42"`)
- In `params` JSON, prefer a **number**: `"{\"courseId\":42}"` (string form `"42"` also works)


## 3. Routing fields (`data` block)

### 3.1 Common display fields (optional)

Used when the message is **data-only** (no `notification` block) or as Android fallbacks.

| Key | Required | Example | Description |
|---|---|---|---|
| `title` | No | `"Assignment due"` | Shown as notification title (Android data-only) |
| `body` | No | `"Complete before midnight"` | Shown as notification body |
| `image` | No | `"https://cdn.example.com/banner.jpg"` | Big-picture image (Android) / attachment (iOS via Notifee) |
| `channelId` | No | `"websankul-offer"` | Android channel. Default: `websankul-default` |

**Registered Android channels** (`src/helpers/Constants.ts`):

| `channelId` | Use case |
|---|---|
| `websankul-default` | General notifications (default) |
| `websankul-social` | Social / community |
| `websankul-offer` | Offers & promotions |

---

### 3.2 Mode A — In-app deep link (recommended)

Navigate inside the app via URL path. Use **`deepLink`** (preferred) or legacy **`clickAction`**.

| Key | Required | Type | Description |
|---|---|---|---|
| `deepLink` **or** `clickAction` | **Yes** | string | Target URL or path (see §4) |
| `viewType` | No | string | Omit or any value except `link` / `dialog` |

**Example — open a test series:**

```json
{
  "notification": {
    "title": "New Test Series",
    "body": "GPSC Prelims Mock #5 is live"
  },
  "data": {
    "deepLink": "com.gpscvideo.gpsc://test-series/1024",
    "channelId": "websankul-default"
  }
}
```

**Example — using a share URL (auto-normalised by the app):**

```json
{
  "data": {
    "deepLink": "https://websankul-api.4tysixapplabs.com/share/courses/42"
  }
}
```

**Example — relative path (legacy):**

```json
{
  "data": {
    "clickAction": "/course/42"
  }
}
```

---

### 3.3 Mode B — Direct screen navigation

Route by React Navigation screen name instead of a URL. Useful when the destination needs params that do not map cleanly to a path.

| Key | Required | Type | Description |
|---|---|---|---|
| `screen` | **Yes** | string | Must match a route name in `AppStack` (see §5) |
| `params` | No | string (JSON) | Serialised navigation params |

**Example — open notifications list:**

```json
{
  "notification": {
    "title": "You have a new message",
    "body": "Tap to view"
  },
  "data": {
    "screen": "NotificationScreen"
  }
}
```

**Example — open course with params:**

```json
{
  "data": {
    "screen": "Subject",
    "params": "{\"courseId\":42}"
  }
}
```

**Example — nested tab navigation:**

```json
{
  "data": {
    "screen": "MainTabs",
    "params": "{\"screen\":\"Library\"}"
  }
}
```

---

### 3.4 Mode C — External link

Open a URL outside the app (browser, WhatsApp, etc.).

| Key | Required | Value | Description |
|---|---|---|---|
| `viewType` | **Yes** | `"link"` | Tells the app to use `Linking.openURL` |
| `deepLink` **or** `clickAction` | **Yes** | string | Full `https://…` or custom-scheme URL |

```json
{
  "notification": {
    "title": "Visit our website",
    "body": "New blog post published"
  },
  "data": {
    "viewType": "link",
    "deepLink": "https://websankul.com/blog/new-post"
  }
}
```

---

### 3.5 Mode D — Dialog (no navigation)

| Key | Required | Value |
|---|---|---|
| `viewType` | **Yes** | `"dialog"` |

Tap is acknowledged but the app does not navigate. Reserved for future in-app dialog handling.

---

## 4. Supported deep-link paths

Defined in `src/navigation/navigationRef.ts` (`deepLinkingConfig`).  
The app normalises share URLs and legacy prefixes before routing.

| Path | Screen | Param name | Example `deepLink` |
|---|---|---|---|
| `course/<id>` | `Subject` | `courseId` | `com.gpscvideo.gpsc://course/42` |
| `package/<id>` | `CourseMaterial` | `courseId` + `isPackage: true` | `com.gpscvideo.gpsc://package/88` |
| `live-course/<id>` | `LiveCourseMaterial` | `liveCourseId` | `com.gpscvideo.gpsc://live-course/15` |
| `book/<id>` | `LibraryBookDetails` | `bookId` | `com.gpscvideo.gpsc://book/301` |
| `ebook/<id>` | `LibraryEBookDetails` | `bookId` | `com.gpscvideo.gpsc://ebook/205` |
| `test-series/<id>` | `TestSeriesDetails` | `seriesId` | `com.gpscvideo.gpsc://test-series/1024` |
| `home` | `MainTabs` → Home tab | — | `com.gpscvideo.gpsc://home` |
| `library` | `MainTabs` → Library tab | — | `com.gpscvideo.gpsc://library` |
| `profile` | `MainTabs` → Profile tab | — | `com.gpscvideo.gpsc://profile` |
| `tests` | `DailyTestList` | — | `com.gpscvideo.gpsc://tests` |
| `notes` | `Notes` | — | `com.gpscvideo.gpsc://notes` |
| `notifications` | `NotificationScreen` | — | `com.gpscvideo.gpsc://notifications` |

### Accepted URL prefixes

The app also accepts these prefixes (all normalised internally):

- `com.gpscvideo.gpsc://`
- `https://websankul-api.4tysixapplabs.com/share/…` (and `/share/courses/`, `/share/packages/`, etc.)
- `https://api.websankul.com/…`
- `https://gpsconline.page.link/…` (legacy Firebase Dynamic Links)
- `myapp://` (legacy)

**Share URL → in-app path mapping:**

| Share path segment | Normalised path | Example |
|---|---|---|
| `/share/courses/<id>` | `course/<id>` | `…/share/courses/42` |
| `/share/packages/<id>` | `package/<id>` | `…/share/packages/88` |
| `/share/live-courses/<id>` | `live-course/<id>` | `…/share/live-courses/15` |
| `/share/books/<id>` | `book/<id>` | `…/share/books/301` |
| `/share/ebooks/<id>` | `ebook/<id>` | `…/share/ebooks/205` |
| `/share/test-series/<id>` | `test-series/<id>` | `…/share/test-series/1024` |

> `<id>` is always a **numeric SQL primary key** (integer), not a MongoDB ObjectId.

---

## 5. Valid `screen` values (Mode B)

Use exact route names from `AppStack`. Common targets:

| `screen` | Typical `params` (JSON string) |
|---|---|
| `Subject` | `{"courseId":42}` |
| `CourseMaterial` | `{"courseId":88,"isPackage":true}` |
| `LiveCourseMaterial` | `{"liveCourseId":15}` |
| `LibraryBookDetails` | `{"bookId":301}` |
| `LibraryEBookDetails` | `{"bookId":205}` |
| `TestSeriesDetails` | `{"seriesId":1024}` |
| `NotificationScreen` | omit or `{}` |
| `Notes` | omit or `{}` |
| `DailyTestList` | omit or `{}` |
| `MainTabs` | `{"screen":"Home"}` / `"Library"` / `"Profile"` |

> Prefer **Mode A (deep link)** for content detail screens — it matches share links and works even when the user is not yet on the target stack.

---

## 6. Complete FCM examples (copy-paste)

### 6.1 Course detail

```json
{
  "to": "<DEVICE_FCM_TOKEN>",
  "notification": {
    "title": "New lectures added",
    "body": "5 new videos in your course"
  },
  "data": {
    "deepLink": "com.gpscvideo.gpsc://course/42",
    "channelId": "websankul-default"
  }
}
```

### 6.2 Package (imperative route)

```json
{
  "data": {
    "deepLink": "com.gpscvideo.gpsc://package/88",
    "title": "Package offer",
    "body": "Tap to explore",
    "channelId": "websankul-offer"
  }
}
```

### 6.3 Offer with image

```json
{
  "notification": {
    "title": "50% off Test Series",
    "body": "Limited time offer"
  },
  "data": {
    "deepLink": "com.gpscvideo.gpsc://test-series/1024",
    "channelId": "websankul-offer",
    "image": "https://cdn.websankul.com/offers/50off.jpg"
  }
}
```

### 6.4 External website

```json
{
  "data": {
    "viewType": "link",
    "deepLink": "https://websankul.com/refer-and-earn",
    "title": "Refer & Earn",
    "body": "Share and earn rewards"
  }
}
```

### 6.5 Screen + params (no URL)

```json
{
  "data": {
    "screen": "TestSeriesDetails",
    "params": "{\"seriesId\":1024}",
    "title": "Mock test result",
    "body": "Your score is ready"
  }
}
```

---

## 7. Comparison with NetworkCounts (reference app)

NetworkCounts (reference project) uses the same FCM + status-bar tap pattern but a **type-discriminator** model instead of URLs:

| NetworkCounts `data` field | Routes to |
|---|---|
| `notification_type: "1"` + `post_id` | `PostDetails` |
| `notification_type: "pending_invitation_request"` | Notifications tab |
| `notification_type: "seeking_match"` + `providing_service_id` | `LeadsScreen` |
| (default) | `UserNotification` |

Websankul uses **`deepLink` / `screen`** instead of `notification_type`. The backend should **not** send NetworkCounts-style `notification_type` fields — they are ignored.

---

## 8. Auth & timing behaviour

- If the user is **not logged in** when a deep link arrives, the URL is **queued** and replayed after login (`replayPendingDeepLink` in `useDeepLinkController.ts`).
- Navigation retries up to ~6 s (20 × 300 ms) until the navigator is ready and the user is past auth screens (`Splash`, `Login`, `OTP`, etc.).
- User must be logged in for in-app destinations; external `viewType: "link"` URLs open regardless.

---

## 9. Checklist for backend

- [ ] Put **all routing fields in `data`**, not only in `notification`
- [ ] Ensure every `data` value is a **string**
- [ ] Use `deepLink` (preferred) or `clickAction` (legacy) for in-app navigation
- [ ] Use `viewType: "link"` only for external URLs
- [ ] Encode `params` as a **JSON string** when using `screen`
- [ ] Set `channelId` to `websankul-offer` / `websankul-social` when appropriate
- [ ] Use **numeric SQL IDs** in paths and params (e.g. `course/42`, not ObjectId strings)
- [ ] Test all three states: **killed**, **background**, **foreground**

---

## 10. Source files

| File | Responsibility |
|---|---|
| `src/helpers/notificationHandler.ts` | FCM receive, Notifee display, tap handlers |
| `src/navigation/useDeepLinkController.ts` | Deep link normalisation, Notifee press in linking subscriber |
| `src/navigation/navigationRef.ts` | `deepLinkingConfig` path → screen map |
| `index.js` | Background FCM handler registration |
| `App.tsx` | Wires handlers on boot |
