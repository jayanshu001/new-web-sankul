# Share / Deep-Link Domain Separation

**Goal:** move public share links off the API domain.

`https://websankul-api.4tysixapplabs.com/share/courses/123`
→ `https://share.gpscvideo.com/share/courses/123`

**Why:** the API domain is currently registered as an App/Universal Link domain for both apps with a
total wildcard (`"paths": ["*"]` / `handle_all_urls`), so the OS treats *every* URL on it —
including `/api/v1/*` — as belonging to the app. Plus `/share/*` is public HTML with no rate limit,
and `SHARE_BASE_URL` being unset means the link base can fall back to the client-supplied `Host`
header.

> **Read §2.4 before scheduling.** The iOS app release must ship **before** the backend cutover, not
> after. Doing it in the other order sends installed iOS users to the App Store.

---

## 1. Requirements

**Domain & infra**
- Subdomain `share.gpscvideo.com`, DNS → same load balancer as the API.
- Valid TLS certificate. App/Universal Links fail on a bad cert **or any redirect** on
  `/.well-known/*`.
- Host routing to the same backend:
  - `share.*` → `/share/*`, `/.well-known/*`
  - `api.*` → `/api/v1/*`, `/uploads/*`, health (unchanged)
- The share host must **not** serve `/api/v1/*`.
- `.well-known` files must return **HTTP 200, `application/json`, no redirect, no auth**.

**Backend**
- `SHARE_BASE_URL` env var (§3.4), required in production.
- Ability to deploy backend and flip the env var independently — the cutover is a config change.

**Apps**
- **iOS:** a store release is **required** (see §2.4). Needs Associated Domains entitlement, the
  correct `appID` (`TEAMID.bundleID`), and URL handling.
- **Android:** store release optional. Needs manifest intent-filter + assetlinks if you want it.
- Both keep their existing custom-scheme handlers.

**Verify before starting** — two existing issues that will bite during the app work:
- `.env` has `APP_WEB_HOST=https://com.gpscvideo.com` — a package-name-shaped host, while
  `SHARE_FALLBACK_URL` right below is `https://www.gpscvideo.com/`. The iOS not-installed path
  redirects there. Check `curl -sI https://com.gpscvideo.com`; if it doesn't resolve, that path is
  broken today, independent of this migration.
- AASA declares `com.websankul.ios` while Android and `APP_SCHEME` use `com.gpscvideo.gpsc`. A wrong
  `appID` disables Universal Links silently — and per §2.4, iOS depends on them entirely.

---

## 2. End-to-end flow

### 2.1 How a share link is produced

1. Client app calls e.g. `GET /api/v1/client/ebooks`.
2. The controller builds the link via `buildShareUrl()` (`src/deeplinking/shareRedirect.ts:43`) →
   `{base}/share/{resource}/{id}`.
3. `base` today = `SHARE_BASE_URL` (unset) → `ORIGIN` → `req.get("host")`, so it resolves to the API
   host.
4. The value ships in the response as `shareableLink`.
5. User taps Share → the link goes into WhatsApp / Telegram / SMS.

### 2.2 What happens when the recipient taps it — **today**

The share URL is served by `/share/:resource/:id`
(`src/deeplinking/deeplinking.routes.ts`), which returns a small HTML page whose JS branches on
user-agent (`templates/share-redirect.html`).

**Android**

| State | Path taken |
|---|---|
| App installed | HTML page loads → JS → `com.gpscvideo.gpsc://course/123` (**custom scheme**) → app opens |
| Not installed | scheme fails → 1.5s timer → Play Store |

**iOS** — different mechanism entirely:

| State | Path taken |
|---|---|
| App installed | **The HTML page never loads.** The URL is a Universal Link (the API host's AASA claims `paths: ["*"]`), so iOS opens the app directly |
| Not installed | HTML page loads → JS → App Store immediately, plus a 500ms timer to `APP_WEB_HOST` |

**Desktop / other** → `SHARE_FALLBACK_URL` (`https://www.gpscvideo.com/`).

> **Key asymmetry:** the iOS branch of the page **never uses the custom scheme** — it only knows
> App Store and `APP_WEB_HOST`. iOS reaches the app *solely* through Universal Links on the API
> host. Android reaches it through the custom scheme, which is domain-independent.

### 2.3 What happens after the move

Identical, except the link is `https://share.gpscvideo.com/share/courses/123`, that host serves the
page, and iOS's Universal Link association points at the **share** host instead of the API host.

```
app  →  GET /api/v1/... (API host)  →  shareableLink = https://share.gpscvideo.com/share/courses/123
                                                              │
recipient taps ──────────────────────────────────────────────┘
   iOS + installed      → Universal Link (share host AASA)      → app opens directly
   iOS + not installed  → share page → App Store / APP_WEB_HOST
   Android + installed  → share page → com.gpscvideo.gpsc://…   → app opens
   Android + not inst.  → share page → Play Store
   Desktop              → SHARE_FALLBACK_URL

old API-host links → 301 → share host → page → custom scheme (still works, browser bounce remains)
```

### 2.4 ⚠ Ordering constraint — the iOS app release comes FIRST

Because iOS depends on Universal Links and has **no custom-scheme fallback in the page**, moving the
link domain before shipping the app update causes a regression:

> Installed iOS user taps the new link → share host is not an associated domain for their build →
> no Universal Link → HTML page loads → **App Store**. The user owns the app and is sent to the
> store.

Android has no such problem: the custom scheme works regardless of host, so Android is safe either
way.

**Therefore:**
- **iOS: the app release is required, and must ship — and reach good adoption — before the cutover.**
  It is not optional Phase-2 polish.
- **Android: the app release is genuinely optional** (only removes the browser bounce).
- During the transition the app must be associated with **both** hosts, and `.well-known` must be
  live on the share host **before** the app update ships, since verification happens at
  install/update.

*Alternative if you cannot wait for an app release:* add the custom scheme to the iOS branch of
`share-redirect.html` as a fallback. Be aware iOS Safari often blocks scheme navigation from JS
without a user gesture, so this is less reliable than Universal Links — treat it as a stopgap.

---

## 3. Changes by Backend

**3.1 — New file `src/utils/shareBase.ts`**

```ts
// Public origin for share links. Never derived from the request Host header:
// that value is client-supplied. Prod presence is enforced at boot (3.3).
const CONFIGURED = (process.env.SHARE_BASE_URL || "").replace(/\/+$/, "");

export const shareBase = (): string =>
  CONFIGURED || (process.env.ORIGIN || "http://localhost:4001").replace(/\/+$/, "");
```

**3.2 — `src/deeplinking/shareRedirect.ts`** — use it in `buildShareUrl` (line 43); delete the
unused `SHARE_BASE_URL` const at line 36:

```ts
import { shareBase } from "../utils/shareBase";

export function buildShareUrl(resource: string, id: string, _fallbackBase?: string): string {
  const cleanResource = resource.replace(/^\/+|\/+$/g, "");
  return `${shareBase()}/share/${cleanResource}/${id}`;
}
```

**3.3 — `src/config/env.ts`** — add to `REQUIRED_IN_PROD` (line 27): `"SHARE_BASE_URL",`

**3.4 — Env files**

```bash
# .env
SHARE_BASE_URL=https://share.gpscvideo.com
# .env.example
SHARE_BASE_URL=http://localhost:4001
```

**3.5 — `src/app.ts`** — legacy links must keep resolving forever. Wrap the mount at line 92 (add
`shareLimiter` to the `config/rateLimiter` import at line 12):

```ts
const SHARE_HOST = (() => {
  try { return new URL(process.env.SHARE_BASE_URL || "").host; } catch { return ""; }
})();

app.use("/share", shareLimiter, (req, res, next) => {
  if (SHARE_HOST && req.hostname !== SHARE_HOST) {
    return res.redirect(301, `${process.env.SHARE_BASE_URL}${req.originalUrl}`);
  }
  return next();
}, deeplinkingRoutes);
```

> Old links keep the browser bounce permanently: iOS/Android do not re-evaluate link association
> across a server redirect, so a 301'd link never becomes a Universal/App Link. It still opens the
> app via the page. Expected, not a bug.

**3.6 — `src/config/rateLimiter.ts`** — `/share/*` has no limiter today:

```ts
export const shareLimiter = gate(rateLimit({
  windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false,
}));
```

**3.7 — `public/.well-known/apple-app-site-association`** — narrow the wildcard (still covers every
share URL, so it is safe to do immediately):

```jsonc
{ "applinks": { "apps": [], "details": [
  { "appID": "4RYQ6JBR5B.com.websankul.ios", "components": [ { "/": "/share/*" } ] }
] } }
```

Serve `.well-known/*` from **both** hosts during the transition (`src/app.ts:73-87`). Drop it from
the API host only once the new app build has high adoption — old builds still rely on it.

**3.8 — Cleanup** — delete the 7 copies of `resolveBase` and drop the 3rd arg at each
`buildShareUrl(...)` call, then remove `_fallbackBase` from 3.2:

```
client/ebook:16   client/book:29        client/free:12      client/live-course:9
client/testSeries:17  client/package:25  client/educator:11  client/course:148 (inline)
```

**Do not change:** `ALLOWED_ORIGINS` / CORS (share pages are top-level navigations, not XHR), the
CSP+nonce in `deeplinking.routes.ts`, or any API response shape — `shareableLink` keeps its key and
type.

---

## 4. Changes by App

> **URL path ≠ deep-link path.** The share URL is **plural**; the path the app already routes on is
> **singular**. A Universal/App Link handler receives the URL, so it must map first.
>
> | Share URL | App routes on |
> |---|---|
> | `/share/courses/:id` | `course` |
> | `/share/books/:id` | `book` |
> | `/share/ebooks/:id` | `ebook` |
> | `/share/live-courses/:id` | `live-course` |
> | `/share/packages/:id` | `package` |
> | `/share/test-series/:id` | `test-series` *(same both ways)* |
> | `/share/educators/:id` | `educator` |

### iOS — **required before cutover**

- Xcode → Signing & Capabilities → Associated Domains → add `applinks:share.gpscvideo.com`.
  **Keep** `applinks:websankul-api.4tysixapplabs.com` until old links stop mattering.
- Confirm `appID` = `TEAMID.bundleID` of the shipping build (see §1).
- Keep the existing `CFBundleURLTypes` custom-scheme handler.

```swift
let shareResourceMap = [
    "courses": "course", "books": "book", "ebooks": "ebook",
    "live-courses": "live-course", "packages": "package",
    "test-series": "test-series", "educators": "educator",
]

func application(_ app: UIApplication, continue userActivity: NSUserActivity,
                 restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
    guard userActivity.activityType == NSUserActivityTypeBrowsingWeb,
          let url = userActivity.webpageURL else { return false }
    let parts = url.pathComponents.filter { $0 != "/" }   // ["share","courses","123"]
    guard parts.count >= 3, parts[0] == "share",
          let resource = shareResourceMap[parts[1]] else { return false }
    return route(resource: resource, id: parts[2])        // same routing as the custom scheme
}
```

### Android — optional (only removes the browser bounce)

Add alongside the existing custom-scheme filter:

```xml
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="https" android:host="share.gpscvideo.com" android:pathPrefix="/share" />
</intent-filter>
```

`assetlinks.json` on the share host, package `com.gpscvideo.gpsc`, **keep both** SHA-256
fingerprints (the second is the Play App Signing key). Handle in `onCreate` **and** `onNewIntent`:

```kotlin
private val shareResourceMap = mapOf(
    "courses" to "course", "books" to "book", "ebooks" to "ebook",
    "live-courses" to "live-course", "packages" to "package",
    "test-series" to "test-series", "educators" to "educator",
)

intent?.data?.pathSegments?.let { seg ->                  // ["share","courses","123"]
    if (seg.size >= 3 && seg[0] == "share") {
        shareResourceMap[seg[1]]?.let { route(it, seg[2]) }
    }
}
```

---

## 5. Order

| # | Step | Where |
|---|---|---|
| 1 | Narrow the AASA wildcard (3.7) | backend |
| 2 | DNS + TLS + host routing | infra |
| 3 | Deploy backend (3.1–3.6) with `SHARE_BASE_URL` **unset**; `.well-known` live on **both** hosts | backend |
| 4 | **iOS release** with `applinks:share…` (+ Android if wanted) | apps |
| 5 | **Wait for adoption** — installed iOS users on old builds still need the API host | — |
| 6 | Set `SHARE_BASE_URL` in staging, verify §6 | infra |
| 7 | **Set `SHARE_BASE_URL` in production ← cutover** | infra |
| 8 | Cleanup (3.8) | backend |
| 9 | Remove `.well-known` from the API host — long after step 5 | backend |

Steps 4→5→7 are the part that cannot be reordered.

---

## 6. Verify

```bash
# links now point at the share host
curl -s -H "Authorization: Bearer $TOKEN" "$API/api/v1/client/ebooks" \
  | grep -o '"shareableLink":"[^"]*"' | head

curl -sI https://share.gpscvideo.com/share/courses/1                              # 200 + CSP
curl -sI https://websankul-api.4tysixapplabs.com/share/courses/1 | grep -i "^HTTP\|^location"  # 301
curl -sI https://share.gpscvideo.com/.well-known/assetlinks.json                  # 200, no redirect
curl -sI https://share.gpscvideo.com/.well-known/apple-app-site-association       # 200, no redirect
curl -s -o/dev/null -w "%{http_code}\n" https://share.gpscvideo.com/api/v1/client/ebooks  # 404
curl -s -o/dev/null -w "%{http_code}\n" https://share.gpscvideo.com/share/courses/abc     # 400
```

```bash
adb shell am start -a android.intent.action.VIEW -d "https://share.gpscvideo.com/share/courses/123"
adb shell pm get-app-links com.gpscvideo.gpsc     # expect: verified
```

iOS: validate the AASA with Apple's validator, then tap a link from Messages/Notes — typing it into
the Safari address bar does **not** trigger Universal Links.

Check all 7 resources (courses, books, ebooks, live-courses, packages, test-series, educators),
installed **and** not-installed, on both platforms. The single most important case:
**installed iOS user taps a new link → app opens, not the App Store.**

---

## 7. Rollback

| Symptom | Action |
|---|---|
| Links wrong/broken after cutover | **Unset `SHARE_BASE_URL`** → instantly reverts to the API host |
| iOS users landing in the App Store | Unset `SHARE_BASE_URL`; adoption of the new build was too low — wait longer |
| Share host down | Unset `SHARE_BASE_URL`; the API host still serves `/share/*` until step 9 |

Only step 9 is not cheaply reversible — old app builds depend on it.
