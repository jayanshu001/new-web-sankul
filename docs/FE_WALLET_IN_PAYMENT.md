# Wallet ("coin") in Payment — Frontend Integration

**Status:** Backend is complete. All 4 create-order endpoints now accept a `coin`
field, charge Razorpay the reduced amount, and debit the wallet on payment
verify. FE just needs to **send `coin`** in the order payload.

**Base:** `/api/v1/client` · **Auth:** `Authorization: Bearer <token>` on all.

---

## TL;DR for FE

1. Read balance from `GET client/referral/rewards` → `data.customer.rewardPoints`.
2. Cap the user's wallet input at `min(floor(planPrice / 2), rewardPoints)`.
3. **Add `"coin": <integer>` to the create-order payload.** (This is the only
   real change — everything else already exists.)
4. Open Razorpay with `data.razorpay.amount` (already reduced — paise).
5. On success, call `/payment/verify` as today. BE deducts the coins; re-fetch
   `client/referral/rewards` to refresh the displayed balance.

---

## 1. Which endpoints accept `coin`

| Product | Endpoint | Add to body |
|---|---|---|
| Course | `POST client/payment/create-order/course` | `"coin": <int>` |
| Package | `POST client/payment/create-order/package` | `"coin": <int>` |
| Live Course | `POST client/payment/create-order/live-course` | `"coin": <int>` |
| Test Series | `POST client/payment/create-order/test-series` | `"coin": <int>` |
| E-Book | `POST client/payment/create-order/ebook` | `"coin": <int>` |

`coin` is **optional**. Omit it or send `0` when the user doesn't use the wallet.

### Example payload (any endpoint)
```json
{
  "planId": "6a1d...",        // or "packageId" for course/package (unchanged)
  "promocode": "SAVE50",      // optional, unchanged
  "coin": 250
}
```
- `coin` is **rupees, an integer** (same unit as the displayed balance).
- Send the **same** other fields you send today — `coin` is purely additive.

---

## 2. Validation rules (must match BE exactly)

BE enforces these and returns a `400` if violated, so mirror them client-side to
give an inline error before submit:

```
maxWalletUsable = min(floor(planPrice * 0.5), rewardPoints)
validCoin       = Number.isInteger(coin) && coin >= 0 && coin <= maxWalletUsable
```

- The 50% cap is on the **plan price** (pre-GST/handling), not the post-promo or
  post-GST total. Same rule for all products.
- `coin` must be a non-negative **integer**.

### BE error responses (HTTP 400)
| Condition | `message` |
|---|---|
| `coin > rewardPoints` | `"Insufficient wallet balance"` |
| `coin > floor(planPrice / 2)` | `"Wallet usage cannot exceed 50% of the plan price"` |
| `coin < 0` or non-integer | `"Invalid wallet amount"` |
| price after promo + wallet < ₹1 | `"Amount after discount and wallet is below the minimum payable. Please reduce wallet usage."` |

Surface `response.data.message` to the user.

---

## 3. The charged amount comes from BE — don't recompute

The create-order response already returns the **post-coin** amount. Drive Razorpay
from it; never recompute on the FE.

```json
{
  "success": true,
  "data": {
    "razorpay": { "orderId": "order_...", "keyId": "rzp_...", "amount": 120000, "currency": "INR" },
    "amountInRupees": 1200,
    "...": "..."
  }
}
```
- `razorpay.amount` = **paise, already discounted AND wallet-reduced** → hand
  straight to the Razorpay SDK.
- `amountInRupees` = the same value in rupees, for the success modal.

> Example: plan ₹2000, promo −₹500, wallet `coin: 300` → BE charges ₹1200 →
> `razorpay.amount = 120000`, `amountInRupees = 1200`.

---

## 4. When the wallet is actually deducted

The coins are **NOT** deducted at create-order. They are deducted **after**
`POST client/payment/verify` succeeds (i.e. after the user actually pays). So:

- Between create-order and verify, the balance is unchanged.
- After a successful verify, the BE has subtracted `coin` from `rewardPoints` and
  written a debit transaction.
- **FE action after verify success:** re-fetch `GET client/referral/rewards` to
  show the new balance (or optimistically decrement the Redux value by `coin`).

No change to the verify call itself — send the 3 razorpay fields as today.

---

## 5. The referral-enabled gate (unchanged)

```
GET client/referral/status  →  data.enabled
```
If `enabled === false`, hide the "Use Wallet Balance" row and **never send
`coin`** (or send `0`). No other change.

---

## 6. Balance source (unchanged)

```
GET client/referral/rewards
→ { data: { customer: { rewardPoints: 350, referralCode: "YUG50GGG" } } }
```
`rewardPoints` is the single source of truth for the wallet balance on every
payment screen. BE updates it before responding to any post-verify rewards call.

---

## 7. End-to-end sequence

```
User enters wallet amount (capped at min(floor(price/2), balance))
        │
        ▼
FE: POST create-order  { planId, promocode?, coin: 250 }
        │
        ▼
BE: validates coin ≤ balance && coin ≤ floor(price/2)
BE: Razorpay order for (price − promoDiscount − coin)
BE: returns { razorpay: { amount }, amountInRupees }   ← already reduced
        │
        ▼
FE: open Razorpay with razorpay.amount (paise)
        │
        ▼
User pays the reduced amount
        │
        ▼
FE: POST client/payment/verify  { razorpay_order_id, razorpay_payment_id, razorpay_signature }
        │
        ▼
BE: verifies signature → provisions access
BE: debits `coin` from rewardPoints + writes a referral debit transaction
BE: returns success
        │
        ▼
FE: success modal, re-fetch client/referral/rewards (new balance)
```

---

## 8. Edge cases the FE should know

- **Balance dropped between create-order and verify** (e.g. a parallel purchase):
  BE deducts *what's available* and never blocks provisioning — the user already
  paid the reduced amount, so the order always completes. FE doesn't need to
  handle this specially; just re-fetch the balance after success.
- **Double verify / webhook race:** BE deduction is idempotent per order — the
  wallet is never double-debited even if verify runs twice.
- **`coin` larger than the post-promo price:** rejected with the "below minimum
  payable" 400. Keep the 50% cap and it can't happen (wallet ≤ 50% of price).
- **Field name:** it is exactly `coin` (matches the old app). Integer rupees.

---

## 9. FE checklist per payment screen

- [ ] Fetch balance from `client/referral/rewards`; hide wallet row if
      `client/referral/status.enabled` is false.
- [ ] Clamp wallet input to `min(floor(planPrice/2), rewardPoints)`; block
      non-integer / negative.
- [ ] Send `"coin": <int>` in the create-order payload.
- [ ] Launch Razorpay with `data.razorpay.amount` (paise, already reduced).
- [ ] After `/payment/verify` success, re-fetch the wallet balance.
- [ ] Show `response.data.message` on any 400 from create-order.
