# Bank Accounts — Client APIs

Powers the **Bank Details** screen on the Refer & Earn flow. Each customer can save multiple payout bank accounts. Withdrawals from rewards target one of these.

- Mount: `/api/v1/client/referral/bank-accounts`
- Auth: Bearer token (inherits the existing client referral router guard).
- Collection: `ws_customer_bank_accounts`

---

## Data model

| Field               | Type     | Notes                                                            |
| ------------------- | -------- | ---------------------------------------------------------------- |
| `_id`               | ObjectId |                                                                  |
| `customerId`        | ObjectId | Owner. Server-set from auth, never accepted from client.         |
| `accountHolderName` | string   | 1–150 chars.                                                     |
| `ifscCode`          | string   | 11 chars, `^[A-Z]{4}0[A-Z0-9]{6}$`. Always uppercased.           |
| `accountNumber`     | string   | 9–18 digits.                                                     |
| `bankName`          | string   | Auto-filled from IFSC lookup (Razorpay). e.g. `"HDFC BANK"`.     |
| `branchName`        | string   | Auto-filled from IFSC lookup. e.g. `"ANDHERI WEST"`.             |
| `city`              | string   | Auto-filled from IFSC lookup. e.g. `"MUMBAI"`.                   |
| `createdAt`         | Date     |                                                                  |
| `updatedAt`         | Date     |                                                                  |

### IFSC validation

Two-layer check on create and on any IFSC update:

1. **Regex** — `^[A-Z]{4}0[A-Z0-9]{6}$` rejects malformed input fast.
2. **Razorpay IFSC API** — `GET https://ifsc.razorpay.com/{IFSC}` is called server-side. A 404 from Razorpay means the code is well-formed but doesn't map to a real branch → request fails with `400 { "message": "Invalid IFSC code." }`. A 200 returns bank metadata which we persist as `bankName`/`branchName`/`city` so the UI can show "HDFC Bank — Andheri West" without re-fetching.

### Account number validation

- Server-side regex: `^\d{9,18}$` (digits only).
- Client must also send `confirmAccountNumber` — the server rejects the request if they don't match. This mirrors the "Confirm Account Number" field in the UI.

---

## `GET /api/v1/client/referral/bank-accounts`

List the customer's saved accounts, newest first.

```json
{
  "success": true,
  "data": [
    {
      "_id": "6a05...",
      "customerId": "69e0...",
      "accountHolderName": "Rahul Sharma",
      "ifscCode": "HDFC0001234",
      "accountNumber": "1234567890",
      "bankName": "HDFC BANK",
      "branchName": "ANDHERI WEST",
      "city": "MUMBAI",
      "createdAt": "2026-05-13T...",
      "updatedAt": "2026-05-13T..."
    }
  ]
}
```

---

## `POST /api/v1/client/referral/bank-accounts`

### Request

```json
{
  "accountHolderName": "Rahul Sharma",
  "ifscCode": "HDFC0001234",
  "accountNumber": "1234567890",
  "confirmAccountNumber": "1234567890"
}
```

### Response — 201

```json
{
  "success": true,
  "data": {
    "_id": "6a05...",
    "customerId": "69e0...",
    "accountHolderName": "Rahul Sharma",
    "ifscCode": "HDFC0001234",
    "accountNumber": "1234567890",
    "bankName": "HDFC BANK",
    "branchName": "ANDHERI WEST",
    "city": "MUMBAI",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

### Errors

| Status | When                                           | Body                                                          |
| ------ | ---------------------------------------------- | ------------------------------------------------------------- |
| 400    | Zod failure (format / confirm mismatch)        | `{ success: false, errors: [...] }`                           |
| 400    | IFSC well-formed but not found by Razorpay     | `{ success: false, message: "Invalid IFSC code." }`           |
| 401    | Missing/invalid Bearer token                   | `{ success: false, message: "Unauthorized" }`                 |
| 500    | Unexpected (e.g. Razorpay outage)              | `{ success: false, message: "..." }`                          |

---

## `PUT /api/v1/client/referral/bank-accounts/:id`

Partial update. Any of `accountHolderName`, `ifscCode`, `accountNumber`, `confirmAccountNumber` may be sent.

- If `accountNumber` is included, `confirmAccountNumber` must match it.
- If `ifscCode` is included, it's re-validated against Razorpay and `bankName`/`branchName`/`city` are refreshed.

### Response — 200

Returns the updated document, same shape as create.

### Errors

Same set as create, plus `404` if the account isn't owned by this customer.

---

## `DELETE /api/v1/client/referral/bank-accounts/:id`

```json
{ "success": true, "message": "Bank account deleted." }
```

`404` if the account isn't owned by this customer.

---

## Notes for the client

- The "Verified" badge on each saved card maps to **the presence of `bankName`** — if it's set, the IFSC was confirmed against Razorpay at create/update time.
- IFSC input field can be uppercased client-side; the server will also uppercase before regex/lookup.
- `confirmAccountNumber` is **not stored** — it's stripped after the equality check.
- Razorpay's IFSC API is free and unauthenticated. If it's down, create/update will return `500`; the client should let the user retry.
