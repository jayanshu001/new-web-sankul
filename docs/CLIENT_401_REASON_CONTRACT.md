# Client 401 Reason Contract — Account Disabled / Deleted

When an admin **disables** or **deletes** a customer, the backend now forces an
immediate logout. The customer's existing access token stops working on the
**very next API call** — no need to wait for it to expire, and no need to call
`token/refresh`.

This doc tells the frontend exactly what response to expect and how to show the
right message.

---

## Where the customer hits this

Any authenticated client API (`/api/v1/client/...` behind the auth middleware —
profile, videos, courses, etc.) will return a **401** on the next request after
the account is disabled/deleted. This is the same 401 your app already uses to
trigger logout. You do **not** need to add any new API call.

---

## 401 response shape

```json
{
  "success": false,
  "code": 401,
  "message": "Your account has been disabled. Please contact support.",
  "data": {
    "reason": "ACCOUNT_DISABLED"
  }
}
```

### Possible `data.reason` values

| `data.reason`     | When it happens                          | `message`                                                 |
| ----------------- | ---------------------------------------- | --------------------------------------------------------- |
| `ACCOUNT_DELETED` | Admin deleted the customer               | `This account no longer exists. Please contact support.`  |
| `ACCOUNT_DISABLED`| Admin disabled / set the customer inactive | `Your account has been disabled. Please contact support.` |
| `SESSION_REVOKED` | Logout-all-devices / generic revocation  | `Session was revoked. Please log in again.`               |

> **Always branch on `data.reason` (the stable code), NOT on the `message`
> text.** The wording may change; the code will not.

---

## What the frontend must do

In your **existing 401 interceptor** (the one that already logs the user out):

```js
// onResponseError (axios example)
if (error.response?.status === 401) {
  const reason  = error.response?.data?.data?.reason;   // ACCOUNT_DISABLED | ACCOUNT_DELETED | SESSION_REVOKED
  const message = error.response?.data?.message;

  // 1. Clear stored access + refresh tokens
  clearTokens();

  // 2. Route to login (do NOT retry / loop the request)
  goToLogin();

  // 3. Show the precise reason for disabled/deleted; generic otherwise
  if (reason === "ACCOUNT_DISABLED" || reason === "ACCOUNT_DELETED") {
    showBannerOnLogin(message);   // e.g. "Your account has been disabled. Please contact support."
  } else {
    showBannerOnLogin("Your session has expired. Please log in again.");
  }
}
```

### Rules

1. **Do not retry the failed request or loop the refresh flow** on a 401 with one
   of these reasons — it is terminal. Clear tokens and go to login.
2. **Field path is `response.data.data.reason`** (the outer `data` is the HTTP
   body; the inner `data` is the API envelope's data object).
3. Treat a missing `reason` the same as `SESSION_REVOKED` (generic logout).

---

## Notes / fallbacks

- The same precise messages are **also** returned by
  `POST /api/v1/client/auth/token/refresh` if the client ever calls it, but this
  is now just a fallback — the regular-API 401 already carries the reason.
- A disabled/deleted customer attempting a **fresh OTP login**
  (`POST /api/v1/client/auth/otp/validate`) is rejected at login as well.
- Re-enabling a disabled customer requires them to **log in again** (their old
  tokens were revoked at disable time).
