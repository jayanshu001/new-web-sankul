# Refer & Earn — Enable / Disable (Admin Guide)

This document explains how an admin can turn the **entire Refer & Earn module on or off** for the whole app, without deleting the program configuration.

> **TL;DR:** The `status` boolean on the `student` `ReferralProgram` is the master switch. `true` = Refer & Earn is live for all users. `false` = checkout ignores referral codes and the client app will hide the Refer & Earn screen.

---

## What the toggle controls

When `status` is set on the `student` referral program:

| `status` value | Backend behavior at checkout                                        | Client app behavior                                   |
|----------------|---------------------------------------------------------------------|-------------------------------------------------------|
| `true`         | Referral codes apply the configured discount and credit the referrer. | App shows the **Refer & Earn** tab/card.              |
| `false`        | Referral codes are silently ignored. Buyer pays full price, no rewards credited. | App **hides** the Refer & Earn tab/card.              |

A `false` toggle is a **clean disable** — it does not delete the program, does not lose the configured percentages, and does not affect already-credited reward points or pending withdrawals. Flipping it back to `true` resumes Refer & Earn instantly with the same percentages.

---

## How to disable Refer & Earn

**Request**
```
PUT /api/v1/admin/referrals/programs/:id
Authorization: Bearer <admin_token>
Content-Type: application/json
```

Replace `:id` with the `_id` of the `student` program (find it via `GET /api/v1/admin/referrals/programs`).

**Body**
```json
{ "status": false }
```

**Success response**
```json
{
  "success": true,
  "data": {
    "_id": "...",
    "name": "student",
    "referralDiscount": 10,
    "referralReward": 20,
    "minimumPrice": 0,
    "status": false,
    "updatedAt": "..."
  }
}
```

---

## How to re-enable Refer & Earn

Same endpoint with `status: true`:

```json
{ "status": true }
```

---

## Suggested admin UI

Add a single toggle (switch) to the **Referral Settings** screen labeled **"Refer & Earn enabled"**. It should:

1. On screen load, call `GET /api/v1/admin/referrals/programs`, find the row where `name === "student"`, and initialize the toggle from its `status` field.
2. On toggle change, call `PUT /api/v1/admin/referrals/programs/:id` with `{ "status": <new_value> }`.
3. Show a small status pill near the toggle: green "Active" when `true`, gray "Disabled" when `false`.
4. If no `student` program exists yet, disable the toggle and show a hint like *"Create the program first to enable Refer & Earn"* (see [REFERRAL_PROGRAM_SETUP.md](REFERRAL_PROGRAM_SETUP.md)).

Optional refinement: when the admin flips the toggle off, show a confirmation dialog like *"Disable Refer & Earn for all users? Referral codes will stop working at checkout and the screen will be hidden from the app."* — to prevent accidental clicks.

---

## What does NOT change when you disable

Flipping `status` to `false` does **not**:
- Delete the program row or its configured percentages.
- Touch any customer's existing `rewardPoints` balance.
- Cancel or affect pending / successful withdrawal transactions.
- Invalidate referral codes that customers have already generated — the codes still exist on the `Customer` document, they just don't do anything at checkout while the program is disabled.

This means **flipping back to `true` is fully reversible** — no data is lost.

---

## Verification checklist

After flipping the toggle, confirm the change took effect:

1. `GET /api/v1/admin/referrals/programs` — confirm the `student` row's `status` matches what you set.
2. From the client app (or via API): `GET /api/v1/client/referral/status` should return `{ "enabled": <matches your toggle> }`.
3. **End-to-end check when disabled:**
   - Have a test customer apply a valid referral code at checkout.
   - The order should go through at **full price** — no discount, no credit.
   - The referrer's `rewardPoints` should stay unchanged.
4. **End-to-end check when re-enabled:**
   - Same flow → discount applies and a `CREDIT` row appears in the referrer's `GET /client/referral/transactions`.

---

## Related endpoints

| Method | Path                                       | Purpose                                  |
|--------|--------------------------------------------|------------------------------------------|
| GET    | `/api/v1/admin/referrals/programs`         | List programs (find the `student` row)   |
| PUT    | `/api/v1/admin/referrals/programs/:id`     | Toggle `status` (and any other field)    |
| GET    | `/api/v1/client/referral/status`           | Public status check (what the app reads) |

All admin endpoints require `Authorization: Bearer <admin_token>` and the `admin` or `super_admin` role.

---

## Related files
- Model: [src/models/referral/ReferralProgram.model.ts](src/models/referral/ReferralProgram.model.ts)
- Admin controller: [src/admin/referral/referral.controller.ts](src/admin/referral/referral.controller.ts)
- Admin routes: [src/admin/referral/referral.routes.ts](src/admin/referral/referral.routes.ts)
- Client status endpoint: [src/client/referral/content.controller.ts](src/client/referral/content.controller.ts)
- Checkout gate (the line that reads `status: true`): [src/client/orders/orders.controller.ts:66](src/client/orders/orders.controller.ts#L66)
