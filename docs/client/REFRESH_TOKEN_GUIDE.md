# Client App — Refresh Token Guide

**Purpose:** when the short-lived access token expires, exchange the refresh token
for a new one so the user stays logged in without re-doing the OTP login.

## When to call it

- **On a 401** from any protected API (access token expired) → call refresh →
  retry the original request.
- **If refresh also returns 401** → refresh token is dead → log out, send user to
  the OTP login screen.
- Do **not** call it on every request, and not after logout.

## API

```
POST /api/v1/auth/token/refresh
Content-Type: application/json

{ "refreshToken": "<stored refresh token>" }
```

**Success — 200**
```json
{
  "success": true,
  "code": 200,
  "message": "Token refreshed successfully.",
  "data": {
    "user": { /* customer profile */ },
    "accessToken": "<NEW access token>",
    "refreshToken": "<NEW refresh token>",
    "isNewUser": false
  }
}
```

**Errors**
| Status | Meaning | Do |
|--------|---------|----|
| 422 | `refreshToken` missing from body | Send the token |
| 401 | Invalid / revoked / expired refresh token | Log out → OTP login screen |

## Rules

- **Rotation:** every refresh returns a **new** refresh token and kills the old
  one. Always overwrite **both** stored tokens with the new pair.
- **One refresh at a time:** never fire two refresh calls in parallel (the first
  invalidates the token the second uses). Use a single-flight lock.

## Token lifetimes

- Access token: **7 days**
- Refresh token: **60 days** (after this, user logs in again)
