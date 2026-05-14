# Refer & Earn — New / Updated APIs

These endpoints back the **My Rewards** screen (wallet balance, quick withdraw, transaction history).

All client routes require `Authorization: Bearer <token>` (same as the rest of `/api/v1/client/*`).
The webhook is the only exception — it is authenticated by Razorpay's HMAC signature instead.

---

## 1. GET `/api/v1/client/referral/transactions/:id`

Detail view for a transaction row in the history list (tap-to-open).

**Auth:** Bearer token.

**Response**
```json
{
  "success": true,
  "data": {
    "_id": "65f2...",
    "customerId": "65a1...",
    "type": "debit",
    "status": "successful",
    "coin": 500,
    "description": "You have requested for bank transfer.",
    "bankAccount": {
      "accountHolderName": "Yug",
      "bankName": "HDFC Bank",
      "ifscCode": "HDFC0000123",
      "accountNumber": "...4821"
    },
    "utr": "UTR2026051000456",
    "failureReason": null,
    "providerRef": "pout_NA1bcd2efgh3",
    "createdAt": "2026-05-14T05:02:00.000Z",
    "updatedAt": "2026-05-14T05:04:13.000Z"
  }
}
```

**Errors**
- `400` — invalid id
- `404` — transaction does not belong to the user

---

## 2. POST `/api/v1/webhooks/razorpay-payout`

Inbound webhook from Razorpay Payouts. Flips a `pending` `ReferralTransaction` to `successful` or `failed` and (on failure) refunds the customer's `rewardPoints`.

**Auth:** HMAC SHA-256 of the raw body, sent as `X-Razorpay-Signature`. No Bearer token.

**Env vars required**
```
RAZORPAY_PAYOUT_WEBHOOK_SECRET=<the secret you configured in the Razorpay dashboard>
```

**Razorpay events handled**

| Event              | Action                                              |
| ------------------ | --------------------------------------------------- |
| `payout.processed` | mark transaction `successful`, store `utr`          |
| `payout.failed`    | mark `failed`, refund coins to customer             |
| `payout.reversed`  | mark `failed`, refund coins                         |
| `payout.rejected`  | mark `failed`, refund coins                         |
| anything else      | `200 OK` with `{ ignored: true }` (no-op)           |

**Matching logic:** uses `payload.payout.entity.id` → `ReferralTransaction.providerRef`. Make sure your payout-creation code stores the Razorpay payout id in `providerRef` when issuing the payout.

**Idempotency:** transactions already in a terminal state (`successful` / `failed`) are skipped — duplicate webhook deliveries are safe.

**Responses**
- `200` — processed (or intentionally ignored)
- `400` — missing raw body
- `401` — bad signature
- `500` — server error / missing webhook secret

---

## 3. POST `/api/v1/client/referral/withdraw` *(existing — now integrated with Razorpay)*

Behaviour change: in addition to deducting coins and creating a `pending` `ReferralTransaction`, this endpoint now:

1. Creates a Razorpay **Contact** for the customer (`reference_id = cust_<customerId>`).
2. Creates a **Fund Account** from the saved bank row (IFSC + account number).
3. Creates an **IMPS Payout** for the requested amount (`reference_id = txn_<transactionId>`).
4. Stores the returned Razorpay `payout.id` on the transaction as `providerRef` — this is what the webhook keys off later.

**Failure handling:** if any of the three Razorpay calls fail, the customer's coins are refunded inside a Mongo transaction, the local `ReferralTransaction` is flipped to `failed` with the Razorpay error in `failureReason`, and the API returns **`502 { success: false, message: "Withdrawal could not be initiated. Please try again." }`**. No stuck "Pending" rows from network errors.

**Env vars required**
```
RAZORPAY_KEY_ID=<existing>
RAZORPAY_KEY_SECRET=<existing>
RAZORPAYX_ACCOUNT_NUMBER=<your RazorpayX virtual account number>
```

**Successful response** (`201`)
```json
{
  "success": true,
  "data": {
    "_id": "65f2...",
    "status": "pending",
    "coin": 500,
    "providerRef": "pout_NA1bcd2efgh3",
    "bankAccount": { "...": "..." }
  }
}
```
The row stays `pending` until Razorpay sends the webhook (see §2).

---

## 4. GET `/api/v1/client/referral/transactions` *(existing — already paginated)*

No code changes. Already supports `?page=&limit=&type=credit|debit`. The new `utr` / `failureReason` / `providerRef` fields will appear automatically once the model picks them up.

---

## Model changes

`ReferralTransaction` (`src/models/referral/ReferralTransaction.model.ts`)

| New field         | Type                  | Purpose                                          |
| ----------------- | --------------------- | ------------------------------------------------ |
| `utr`             | `string`              | Bank reference returned by Razorpay on success.  |
| `failureReason`   | `string`              | Reason copied from Razorpay on failure.          |
| `providerRef`     | `string` *(indexed)*  | Razorpay payout id; used to match webhook events.|
| `providerPayload` | `Mixed`               | Raw Razorpay entity, for audit/debug.            |

Enum `RefferalTransactionStatus` (`src/models/enums.ts`) gained a `FAILED = "failed"` value.

---

## Frontend wiring cheat-sheet

| Screen action               | Endpoint                                          |
| --------------------------- | ------------------------------------------------- |
| Load wallet balance + min   | `GET  /api/v1/client/referral/rewards`            |
| Render transactions list    | `GET  /api/v1/client/referral/transactions`       |
| Tap a transaction row       | `GET  /api/v1/client/referral/transactions/:id`   |
| Tap "Transfer To Bank"      | `POST /api/v1/client/referral/withdraw`           |
| (Razorpay → us)             | `POST /api/v1/webhooks/razorpay-payout`           |
