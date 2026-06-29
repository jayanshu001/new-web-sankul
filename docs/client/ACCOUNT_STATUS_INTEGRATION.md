# Account Status — Frontend Integration Guide

A lightweight probe the app calls on **Home Screen load** to confirm the logged-in
account is still active. If an admin has **disabled** or **deleted** the account
(or the session was revoked), the call fails and the app should **log out and show
the message**.

> TL;DR — call `GET /api/v1/client/auth/account-status` on app/home launch.
> `200` → continue. `401` → read `data.reason`, log out, show `message`.

---

## Endpoint

| | |
|---|---|
| **Method** | `GET` |
| **URL** | `/api/v1/client/auth/account-status` |
| **Auth** | Required — `Authorization: Bearer <accessToken>` |
| **Body** | None |
| **When to call** | On Home Screen load / app foreground / app resume |

---

## Responses

### ✅ Healthy account — `200`
```json
{
  "success": true,
  "code": 200,
  "data": { "active": true },
  "message": "Account is active."
}
```
Proceed to render Home.

### ⛔ Blocked / deleted / revoked — `401`
The body always carries a machine-readable `data.reason`. **Branch on `reason`,
not on the message text** (messages may be reworded later).

| `data.reason` | Meaning | Suggested app action |
|---|---|---|
| `ACCOUNT_DISABLED` | Admin set the account inactive (`status = false`). | Log out, show `message`. |
| `ACCOUNT_DELETED`  | Account soft-deleted (`isAccountDeleted = true`) or no longer exists. | Log out, show `message`. |
| `SESSION_REVOKED`  | Token invalidated (logout-all / password / forced re-auth). | Log out, route to login. |
| `UNAUTHORIZED`     | No/invalid user on the token. | Log out, route to login. |

Example (`ACCOUNT_DISABLED`):
```json
{
  "success": false,
  "code": 401,
  "message": "Your account has been disabled. Please contact support.",
  "data": { "reason": "ACCOUNT_DISABLED" }
}
```

Example (`ACCOUNT_DELETED`):
```json
{
  "success": false,
  "code": 401,
  "message": "This account no longer exists. Please contact support.",
  "data": { "reason": "ACCOUNT_DELETED" }
}
```

### Other failures
- **`401` with a token error** (expired/invalid/missing Bearer) → treat like a
  normal expired session: try a token refresh, and if that fails, route to login.
- **Network / `5xx`** → do **not** force logout. Show a transient retry state; the
  account is not necessarily blocked.

---

## Integration flow

```
App launches / Home Screen mounts
        │
        ▼
GET /client/auth/account-status   (with Bearer token)
        │
   ┌────┴─────────────────────────────┐
 200 active:true                    401 / error
        │                               │
        ▼                  ┌────────────┴───────────────┐
   Render Home        reason in                 token expired / 5xx
                  ACCOUNT_DISABLED,                    │
                  ACCOUNT_DELETED,             refresh token or
                  SESSION_REVOKED,             show retry (no forced
                  UNAUTHORIZED                 logout on 5xx)
                        │
                        ▼
              Clear local session/token,
              show `message`, route to login
```

---

## Sample code

### Axios — explicit call on Home load
```ts
import axios from "axios";

async function checkAccountStatus(): Promise<boolean> {
  try {
    await axios.get("/api/v1/client/auth/account-status", {
      headers: { Authorization: `Bearer ${getAccessToken()}` },
    });
    return true; // 200 → account active
  } catch (err) {
    const reason = err?.response?.data?.data?.reason;
    const message = err?.response?.data?.message;

    if (["ACCOUNT_DISABLED", "ACCOUNT_DELETED", "SESSION_REVOKED", "UNAUTHORIZED"].includes(reason)) {
      logoutAndShow(message); // clear token + show message + go to login
      return false;
    }

    // Token expired or network/5xx — handle via your normal refresh/retry path.
    throw err;
  }
}
```

### Axios — global response interceptor (covers ALL APIs)
Because **every** authenticated endpoint enforces the same gate, you can also
catch blocked/deleted accounts globally, not just on the probe:
```ts
axios.interceptors.response.use(
  (res) => res,
  (err) => {
    const reason = err?.response?.data?.data?.reason;
    if (reason === "ACCOUNT_DISABLED" || reason === "ACCOUNT_DELETED") {
      logoutAndShow(err.response.data.message);
    }
    return Promise.reject(err);
  }
);
```

### Fetch
```ts
const res = await fetch("/api/v1/client/auth/account-status", {
  headers: { Authorization: `Bearer ${getAccessToken()}` },
});
if (res.ok) {
  // active → render Home
} else if (res.status === 401) {
  const body = await res.json();
  // body.data.reason ∈ ACCOUNT_DISABLED | ACCOUNT_DELETED | SESSION_REVOKED | UNAUTHORIZED
  logoutAndShow(body.message);
}
```

---

## Notes & guarantees

- **Cheap to call often.** The server caches the account gate briefly, so calling
  this on every Home load / resume is fine.
- **Same gate everywhere.** Every authenticated client API applies the same
  block/delete check, so a blocked user is stopped on any call — this endpoint
  just gives the app one explicit, predictable place to detect it first.
- **Propagation timing.** Blocks/deletes made through the admin panel take effect
  **immediately**. (A change made by editing the database directly may take up to
  ~30 seconds to propagate due to caching — not applicable to normal admin
  actions.)
- **Don't hardcode message strings.** Drive UI off `data.reason`; treat `message`
  as display text only.
- This endpoint never returns `200` for a blocked/deleted account — absence of a
  `401` is a positive signal.
