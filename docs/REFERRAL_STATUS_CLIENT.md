# Refer & Earn — Status Check (Client API)

This document describes the public endpoint the app uses to decide whether to **show or hide the Refer & Earn screen** for the user.

> **TL;DR:** Call `GET /api/v1/client/referral/status` on app start (or whenever the home screen refreshes). If `enabled` is `false`, hide the Refer & Earn entry point entirely.

---

## Endpoint

```
GET /api/v1/client/referral/status
Authorization: Bearer <jwt>
```

**Auth:** Required (same as every other client endpoint).

---

## Response

### When Refer & Earn is enabled

```json
{
  "success": true,
  "data": {
    "enabled": true,
    "referralDiscount": 10,
    "referralReward": 20,
    "minimumPrice": 0
  }
}
```

### When Refer & Earn is disabled (or never configured)

```json
{
  "success": true,
  "data": {
    "enabled": false,
    "referralDiscount": 0,
    "referralReward": 0,
    "minimumPrice": 0
  }
}
```

### Response fields

| Field              | Type    | Meaning                                                                                          |
|--------------------|---------|--------------------------------------------------------------------------------------------------|
| `enabled`          | boolean | **The only field the app must check.** `true` → render Refer & Earn UI. `false` → hide it.       |
| `referralDiscount` | number  | % discount applied to the buyer when they enter a referral code. Use to display marketing copy.  |
| `referralReward`   | number  | % of the final paid amount credited to the referrer. Use to display "earn X%!" messaging.        |
| `minimumPrice`     | number  | Plan price must be **strictly greater than** this (in ₹) for the discount/reward to apply.       |

When `enabled` is `false`, the three numeric fields are returned as `0` for safety — never display them to the user when disabled.

---

## How the backend decides `enabled`

It's `true` if and only if **both** of these are true in the database:
1. A `ReferralProgram` row with `name: "student"` exists.
2. That row's `status` field is `true`.

Admin controls the toggle from the Referral Settings screen — see the admin guide [REFERRAL_STATUS_TOGGLE_ADMIN.md](REFERRAL_STATUS_TOGGLE_ADMIN.md).

---

## Recommended app integration

### 1. When to call it
- **On app start / after login** — cache the result for the session.
- **On pull-to-refresh** of the home screen — pick up admin changes without requiring a re-login.
- **Before navigating to the Refer & Earn screen** — defensive check in case the toggle flipped mid-session.

You generally do **not** need to call it before every checkout — the backend gates checkout independently. The `/status` endpoint is purely a UI signal.

### 2. What to hide when `enabled: false`
- The Refer & Earn tab/card on the home screen.
- Any "Invite a friend" / "Earn rewards" CTAs.
- Deep-link routes that lead into Refer & Earn (or redirect them to the home screen).

### 3. What NOT to hide even when disabled
- The user's **existing reward balance** (`GET /client/referral/rewards` still works) — they should still be able to see what they earned in the past.
- **Withdrawal flow** — if they have a balance, let them withdraw it even after the program is disabled.
- **Transaction history** (`GET /client/referral/transactions`) — historical record stays visible.

A simple way to think about it: `enabled: false` hides the *earning* surface, not the *spending* surface.

### 4. Sample pseudocode

```js
const { data } = await api.get("/client/referral/status");

if (data.enabled) {
  showReferEarnTab({
    discountPct: data.referralDiscount,
    rewardPct: data.referralReward,
  });
} else {
  hideReferEarnTab();
  // But still keep the rewards balance/withdraw flow reachable from Profile
  // if the user has rewardPoints > 0.
}
```

---

## Errors

| Status | Body                                                        | Meaning                                                  |
|--------|-------------------------------------------------------------|----------------------------------------------------------|
| `401`  | `{ "success": false, "message": "Unauthorized" }`           | Missing or invalid Bearer token.                         |
| `500`  | `{ "success": false, "message": "<error>" }`                | Unexpected server error — treat as `enabled: false` defensively. |

A `2xx` response is always trustworthy — `enabled` will be a clean boolean.

---

## Related endpoints

| Method | Path                                  | Purpose                                                     |
|--------|---------------------------------------|-------------------------------------------------------------|
| GET    | `/api/v1/client/referral/status`      | **This endpoint** — UI on/off check                         |
| GET    | `/api/v1/client/referral/rewards`     | User's reward balance + active program details              |
| GET    | `/api/v1/client/referral/transactions`| User's reward ledger                                        |
| POST   | `/api/v1/client/referral/code/generate` | One-time referral code generation                         |

See [REFER_EARN_CLIENT.md](REFER_EARN_CLIENT.md) for the full client API surface.

---

## Related files
- Controller: [src/client/referral/content.controller.ts](src/client/referral/content.controller.ts)
- Routes: [src/client/referral/referral.routes.ts](src/client/referral/referral.routes.ts)
