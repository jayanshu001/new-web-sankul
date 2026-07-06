# Notifications — Client (Mobile App) Integration

What the mobile app must implement so that push notifications sent from the admin panel actually arrive on a device, are rendered correctly, and can be tapped to open the right screen.

Firebase project: **`websankul-17b65`**.

---

## 1. Firebase setup in the app

### Android
- Add `google-services.json` (download from Firebase console → Project settings → `websankul-17b65`) to `android/app/`.
- Add the Google services Gradle plugin and `firebase-messaging` dependency.
- `AndroidManifest.xml` — declare the FCM service class your SDK uses (RN/Flutter wrappers handle this automatically).
- **Android 13+ (API 33+):** request the `POST_NOTIFICATIONS` runtime permission before subscribing to topics or showing notifications.

### iOS
- Add `GoogleService-Info.plist` (same Firebase console) to the iOS project root.
- Enable capabilities: **Push Notifications**, **Background Modes → Remote notifications**.
- Generate an **APNs Authentication Key** in the Apple Developer portal and **upload it to Firebase console → Cloud Messaging → APNs Authentication Key**. Without this, iOS pushes silently never arrive even though the backend reports success.
- Request permission on app start or after login (see §2).

---

## 2. Request notification permission

Prompt the user before relying on push:

- **iOS** — request alert/sound/badge permission via the Messaging SDK.
- **Android 13+** — runtime `POST_NOTIFICATIONS` permission request.
- **Android < 13** — no runtime request needed.

If the user denies, the app should still work; just don't loop the prompt.

---

## 3. Register the FCM token with the backend

The backend can only push to devices whose tokens are stored in `ws_customers.firebaseToken`. The app is responsible for registering the token.

### Endpoint (preferred — authenticated)

```
PUT /api/v1/client/profile/device-token
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "firebaseToken": "<fcm token from messaging SDK>",
  "platform": "ios" | "android"
}
```

Response:
```json
{ "success": true, "message": "Device token registered." }
```

### When to call it

Call this endpoint in all of these cases:

1. **Right after login** — first time the user authenticates, fetch the FCM token and POST it.
2. **App start, if signed in** — compare the current FCM token to what the app last sent; if different, POST again.
3. **`onTokenRefresh` callback** — Firebase rotates tokens periodically (especially after reinstall, restore, or long inactivity). Always re-register.
4. **After permission state changes** — if the user previously denied and later grants permission, the token may have changed.

### Legacy endpoint (still supported)

```
PATCH /api/v1/client/profile/firebase-token
{ "phoneNumber": "...", "firebaseToken": "...", "platform": "ios" | "android" }
```

Public (no auth) — kept for the immediately-post-OTP sync flow before the JWT is in hand. **Use the authenticated `PUT` everywhere else.**

### On logout / account deletion

Clear the token so the device stops receiving pushes for this account:

```
PUT /api/v1/client/profile/device-token
{ "firebaseToken": "" }
```

(Pass an empty string. The backend stores it and skips FCM dispatch for empty/null tokens.)

---

## 4. Receiving notifications

The backend sends FCM messages shaped like:

```json
{
  "notification": {
    "title": "...",
    "body":  "...",
    "imageUrl": "https://... (optional)"
  },
  "data": {
    "deepLink": "/courses/abc (optional)",
    "<anyExtraKey>": "<stringified value>"
  }
}
```

**Important:** every value inside `data` is a string. If the admin sends a nested object via the `data` field on the compose form, the backend JSON-stringifies it before sending — the app must `JSON.parse` if needed.

### Foreground (app in use)
Firebase does **not** show a system-tray notification automatically while the app is foregrounded. The app must:
- Display an in-app banner / toast, **or**
- Post a local notification via the OS notification framework.

### Background / quit
The OS handles display automatically using the `notification` block. Tap → app launches → Firebase delivers the message to the tap handler.

### Tap handling
On notification tap (foreground, background, or cold start):
1. Read `data.deepLink` from the message payload.
2. Navigate to that route inside the app.
3. Optionally, mark the corresponding feed item as read (§5).

Handle three entry points:
- Tap while foreground → SDK callback
- Tap while background → SDK callback (different listener)
- Tap from cold start → check `getInitialNotification()` / equivalent on app launch

---

## 5. In-app notification feed (bell icon)

Independent from FCM delivery — this is the list the user sees when they open the notifications screen inside the app.

### List

```
GET /api/v1/client/notifications?page=1&limit=20
Authorization: Bearer <jwt>
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "title": "...",
      "body": "...",
      "image": "https://... | null",
      "deepLink": "/... | null",
      "type": "general",
      "isRead": false,
      "readAt": null,
      "broadcast": true,
      "createdAt": "..."
    }
  ],
  "unreadCount": 3,
  "pagination": { "total": 42, "page": 1, "limit": 20, "totalPages": 3 }
}
```

The feed includes both **personal** rows (`customerId === me`) and **broadcast** rows (`broadcast: true`). `unreadCount` is for the bell-icon badge.

### Mark one read

```
POST /api/v1/client/notifications/:id/read
```

### Mark all read

```
POST /api/v1/client/notifications/read-all
```

### Image banners (in-app, not push)

```
GET /api/v1/client/image-notifications
```

Returns active banner images with optional `redirectUrl` — render in the home screen / dashboard, not the notification list.

---

## 6. Testing checklist before shipping

Run through these in order; each catches a different failure class.

### Setup checks
- [ ] `google-services.json` / `GoogleService-Info.plist` is for project `websankul-17b65` (open the file and verify `project_id`).
- [ ] iOS: APNs key is uploaded to Firebase console for this project.
- [ ] App requests notification permission and the user grants it.
- [ ] FCM token is logged at app start; copy it for backend tests.

### Token registration check
- [ ] After login, the `PUT /client/profile/device-token` call returns `success: true`.
- [ ] In Mongo, `ws_customers.firebaseToken` for that user matches the token the app logged.
- [ ] On a fresh install (token rotates), the app re-POSTs the new token on first launch.

### Delivery check (ask backend team to run)
```bash
# Backend repo
npx tsx scripts/test-fcm.ts <your-fcm-token>
```
- [ ] Dry-run succeeds (token + payload valid).
- [ ] Real send succeeds AND device shows the notification.

### End-to-end check
- [ ] Admin sends a test notification to your `userId` via the admin panel.
- [ ] Device receives it within seconds.
- [ ] Tapping it opens the app at the `deepLink` route.
- [ ] Opening the bell icon shows the same notification with `isRead: false`.
- [ ] After tap → `POST /:id/read` is called and `unreadCount` decreases.

### Foreground/background/cold-start matrix
Test **each** with a fresh notification:
| App state | Should happen |
|---|---|
| Foreground | App-rendered banner shows; tap navigates |
| Background | System tray shows; tap brings app to front + navigates |
| Quit/killed | System tray shows; tap cold-starts app + navigates |

---

## 7. Common failure modes

| Symptom | Likely cause |
|---|---|
| Backend reports `successCount: 1` but no notification on device | iOS: APNs key missing in Firebase. Android: notification channel not created, or permission denied. |
| Backend reports `successCount: 0, invalidTokensPruned: 1` | Token is stale (app reinstalled, signed out elsewhere). App must call `PUT /device-token` again. |
| Backend reports `targetCount > 0` but `fcmTokensAvailable: 0` (older field) / no tokens to send | App never registered the token after login. |
| Dry-run returns `messaging/sender-id-mismatch` | App is wired to a different Firebase project — wrong `google-services.json` / `GoogleService-Info.plist`. |
| Notification arrives in background but not foreground | App isn't rendering foreground notifications itself — Firebase doesn't do it for you. |
| Tap doesn't navigate | App not reading `data.deepLink`, or cold-start path missing. |
| Notifications stop after a few days | Token rotated and app didn't re-register on `onTokenRefresh`. |

---

## 8. Quick reference — what the app team must build

| Item | Where | When |
|---|---|---|
| Firebase SDK init | App bootstrap | Once at app start |
| Permission request | Login / first launch | Once per install |
| FCM token fetch + POST to backend | After login, on app start, on token refresh | Multiple |
| Foreground notification renderer | Foreground message listener | Every push while foreground |
| Tap handler reading `data.deepLink` | Foreground + background + cold-start listeners | Every tap |
| Bell-icon list screen | Notifications tab | When user opens it |
| Mark-as-read on tap or list view | Bell-icon screen | On interaction |
| Clear token on logout | Logout flow | Once per logout |
