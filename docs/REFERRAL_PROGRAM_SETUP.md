# Referral Program Setup — Admin Guide

This document explains the **one-time configuration** an admin must do so that the Refer & Earn flow actually credits referrers when their code is used at checkout.

> **TL;DR:** A `ReferralProgram` row named `"student"` controls both the buyer's discount and the referrer's reward percentages. Without it (or with values set to `0`), referral codes will not award any reward points.

---

## Why this is required

When a customer (User B) applies another customer's (User A's) referral code at checkout, the backend looks up `ReferralProgram` where `name = "student"` and reads three numbers from it:

| Field             | What it controls                                                                                          |
|-------------------|-----------------------------------------------------------------------------------------------------------|
| `referralDiscount`| % discount applied to **User B**'s order total.                                                           |
| `referralReward`  | % of the final paid amount credited to **User A**'s reward balance.                                       |
| `minimumPrice`    | Discount is only applied if the plan's base price is **strictly greater than** this value (in ₹).         |

If `referralReward` is `0` (the schema default), no credit is given even though the code is accepted. **You must set it explicitly.**

---

## Step 1 — Check whether the program already exists

**Request**
```
GET /api/v1/admin/referrals/programs
Authorization: Bearer <admin_token>
```

**Look for a row where `name: "student"`** in the response. If you find one, note its `_id` and skip to Step 3. If not, go to Step 2.

---

## Step 2 — Create the program (only if it doesn't exist)

**Request**
```
POST /api/v1/admin/referrals/programs
Authorization: Bearer <admin_token>
Content-Type: application/json
```

**Body**
```json
{
  "name": "student",
  "title": "Student Refer & Earn",
  "referralDiscount": 10,
  "referralReward": 20,
  "minimumPrice": 0,
  "initialRewardAmount": 0,
  "status": true
}
```

**Field guide**

| Field                 | Required | Type     | Range           | Meaning                                                                                                  |
|-----------------------|----------|----------|-----------------|----------------------------------------------------------------------------------------------------------|
| `name`                | yes      | string   | 1–50 chars      | Must be exactly `"student"` — the code looks it up by this name.                                         |
| `title`               | yes      | string   | 1–255 chars     | Display title for the client-side Refer & Earn screen.                                                   |
| `image`               | no       | string   | ≤255 chars      | Optional banner image URL shown on the client-side screen.                                               |
| `referralDiscount`    | yes      | number   | 0–100           | % off the buyer's order when they apply a referral code.                                                 |
| `referralReward`      | yes      | number   | 0–100           | **Set this to `20`** — % of paid amount credited to the referrer.                                        |
| `minimumPrice`        | yes      | integer  | ≥ 0             | Discount only kicks in when plan price > this amount. Set `0` to apply on every paid plan.               |
| `initialRewardAmount` | no       | integer  | ≥ 0             | Optional welcome reward (not auto-credited by current code — informational for client UI).               |
| `video`               | no       | string   | ≤255 chars      | Optional explainer video URL for the client-side screen.                                                 |
| `status`              | no       | boolean  | —               | `true` = active. Only active programs are picked up by the checkout flow. Defaults to `true`.            |

**Errors**
- `409 Conflict` — `"Program name already exists."` — a program with that name is already in the DB. Use Step 3 to update it instead.
- `400 Bad Request` — Zod validation errors (check the `errors` array in the response).

---

## Step 3 — Update the existing program

**Request**
```
PUT /api/v1/admin/referrals/programs/:id
Authorization: Bearer <admin_token>
Content-Type: application/json
```

Replace `:id` with the `_id` you noted in Step 1.

**Body — minimum required to enable rewards**
```json
{
  "referralReward": 20
}
```

All fields are optional on update; send only the ones you want to change.

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
    "status": true,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

---

## Step 4 — Verify it's live

1. Hit `GET /api/v1/admin/referrals/programs` again and confirm the `"student"` row now shows `referralReward: 20` and `status: true`.
2. From the client side, simulate a referral purchase end-to-end:
   - User A generates a referral code via `POST /client/referral/code/generate`.
   - User B applies that code as `promocode` at `POST /client/orders/course`.
   - For online payments, complete `POST /client/orders/verify-payment`.
3. Check User A's balance via `GET /client/referral/rewards` — `rewardPoints` should be `20% × paidAmount` higher.
4. Check `GET /client/referral/transactions` — a `CREDIT` row should appear with description `"Referral reward (20%) — course purchase"` (or `package` / `ebook`).

If reward points didn't move, the most common causes are:
- `referralReward` is still `0` — re-check Step 3.
- `status` is `false` — the program is inactive, set it to `true`.
- `minimumPrice` is higher than the plan's base price — the discount **and reward** are skipped together.
- Buyer used their **own** referral code — self-referrals are blocked by design.

---

## Changing the % later

The reward percentage is read from the DB on every checkout — no redeploy needed. Just call Step 3 again with the new value:

```json
{ "referralReward": 25 }
```

Same for the buyer discount (`referralDiscount`) or the minimum-price floor (`minimumPrice`).

---

## Endpoint quick reference

| Method | Path                                       | Purpose                          |
|--------|--------------------------------------------|----------------------------------|
| GET    | `/api/v1/admin/referrals/programs`         | List all referral programs       |
| POST   | `/api/v1/admin/referrals/programs`         | Create a new program             |
| GET    | `/api/v1/admin/referrals/programs/:id`     | Get a single program             |
| PUT    | `/api/v1/admin/referrals/programs/:id`     | Update a program (partial body)  |
| DELETE | `/api/v1/admin/referrals/programs/:id`     | Delete a program                 |

All endpoints require `Authorization: Bearer <admin_token>` and the `admin` or `super_admin` role.

---

## Related files
- Model: [src/models/referral/ReferralProgram.model.ts](src/models/referral/ReferralProgram.model.ts)
- Routes: [src/admin/referral/referral.routes.ts](src/admin/referral/referral.routes.ts)
- Controller: [src/admin/referral/referral.controller.ts](src/admin/referral/referral.controller.ts)
- Validation: [src/admin/referral/referral.validation.ts](src/admin/referral/referral.validation.ts)
- Credit logic: [src/client/referral/credit-referrer.ts](src/client/referral/credit-referrer.ts)
- Checkout integration: [src/client/orders/orders.controller.ts](src/client/orders/orders.controller.ts)
