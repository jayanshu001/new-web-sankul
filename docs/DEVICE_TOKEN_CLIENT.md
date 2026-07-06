# Device Token (FCM) — Client Integration

## Why this changed

Previously the server stored a single `firebaseToken` per customer. When the
same account logged in on two devices, the second login overwrote the first,
so only one device received pushes.

The server now stores **an array of tokens per customer** (`firebaseTokens[]`)
so every logged-in device receives every notification.

To make this work end-to-end, the client must:

1. **Register** the current device's token after login and on FCM token refresh.
2. **Unregister** only the current device's token on logout (do NOT send an
   empty string — use the dedicated DELETE endpoint).

## Endpoints

All endpoints are under `/api/v1/client/profile`. All require `Authorization: Bearer <accessToken>` unless noted.

### 1. Register / refresh — `PUT /device-token`

Call this:
- Right after successful login.
- Whenever Firebase's `onTokenRefresh` fires.
- On app launch if you have a cached token (safe to call repeatedly — server dedupes).

```http
PUT /api/v1/client/profile/device-token
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "firebaseToken": "fcm-token-string",
  "platform": "android"   // or "ios"; optional
}
```

Server behavior: if the token already exists in the user's array, its
`updatedAt`/platform are refreshed; otherwise it is appended. Other devices'
tokens are untouched.

**Response 200:**
```json
{ "success": true, "data": {}, "message": "Device token registered." }
```

### 2. Unregister — `DELETE /device-token` (NEW)

Call this **on logout, before clearing the auth token locally**.

```http
DELETE /api/v1/client/profile/device-token
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "firebaseToken": "fcm-token-string"
}
```

Removes only this device's token. Any other devices the user is logged in on
continue to receive pushes.

**Response 200:**
```json
{ "success": true, "data": {}, "message": "Device token unregistered." }
```

### 3. Legacy phone-based update — `PATCH /firebase-token`

Unchanged in shape; works for the pre-auth post-OTP sync flow. Same
append/dedupe behavior as `PUT /device-token`.

```http
PATCH /api/v1/client/profile/firebase-token
Content-Type: application/json

{
  "phoneNumber": "9876543210",
  "firebaseToken": "fcm-token-string",
  "platform": "android"
}
```

## Required client-side changes (checklist)

- [ ] On **login success** → call `PUT /device-token` with the device's current FCM token.
- [ ] On **`FirebaseMessaging.onTokenRefresh`** → call `PUT /device-token`.
- [ ] On **logout** →
  - [ ] Call `DELETE /device-token` with the device's current FCM token **first**.
  - [ ] Then clear the local auth tokens / call `DELETE /auth/logout`.
  - [ ] Do NOT call `PUT /device-token` with `firebaseToken: ""` — that returns 422.
- [ ] On **uninstall path you control** (e.g. "Delete account") — token is moot because account is soft-deleted; no extra call needed.

## Testing matrix

| Scenario | Expected |
|---|---|
| Log in on Device A; send notification | A receives push |
| Log in on Device B (same account); send notification | A **and** B receive push |
| Logout from Device A; send notification | Only B receives push |
| Logout from Device B; send notification | No device receives push |
| Reinstall app on Device A → new FCM token → PUT /device-token | A receives push under new token; old token is auto-pruned the next time FCM rejects it |

## Migration note

Customers who had a single `firebaseToken` before this release will have an
empty `firebaseTokens[]` array until their app calls `PUT /device-token` again.
Pushes to those users pause until the app does so. Because well-behaved
clients call `PUT /device-token` on app launch / token refresh, this self-heals
within one app open.
