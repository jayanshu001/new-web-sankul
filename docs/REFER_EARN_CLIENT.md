# Refer & Earn — Client API Documentation

Base URL: `/api/v1/client/referral`

**Authentication:** All endpoints require a Bearer token (`Authorization: Bearer <jwt>`). The authenticated customer is resolved from `req.user.id`.

**Common response shape:**
- Success: `{ "success": true, "data": ... }`
- Error: `{ "success": false, "message": "..." }` or `{ "success": false, "errors": [...] }` for Zod validation issues.

---

## 1. Rewards Overview

Returns the logged-in customer's reward summary and the active student referral program(s).

- **Method:** `GET`
- **Path:** `/rewards`
- **Auth:** Required

**Response 200**
```json
{
  "success": true,
  "data": {
    "customer": {
      "id": "<customerId>",
      "firstName": "",
      "middleName": "",
      "lastName": "",
      "phoneNumber": "",
      "referralCode": "ABC12345",
      "rewardPoints": 0
    },
    "program": [ /* active ReferralProgram docs where name="student" */ ]
  }
}
```

**Errors:** `401` Unauthorized, `404` Invalid user.

---

## 2. List My Transactions

Paginated list of the customer's reward ledger (credits from referrals, debits from withdrawals).

- **Method:** `GET`
- **Path:** `/transactions`
- **Auth:** Required

**Query params**
| Name | Type | Default | Notes |
|------|------|---------|-------|
| `page` | number | `1` | Page number (min 1) |
| `limit` | number | `20` | Page size (min 1) |
| `type` | string | — | Optional filter: `CREDIT` or `DEBIT` |

**Response 200**
```json
{
  "success": true,
  "data": [ /* ReferralTransaction docs sorted by createdAt desc */ ],
  "pagination": { "total": 0, "page": 1, "limit": 20, "totalPages": 0 }
}
```

---

## 3. Get Transaction by ID

- **Method:** `GET`
- **Path:** `/transactions/:id`
- **Auth:** Required

**Response 200**
```json
{ "success": true, "data": { /* ReferralTransaction */ } }
```

**Errors:** `400` Invalid transaction id, `404` Not found.

---

## 4. Generate Referral Code (one-time)

The customer picks their own referral code. Can only be set **once** — afterwards a new code cannot be generated.

- **Method:** `POST`
- **Path:** `/code/generate`
- **Auth:** Required

**Body**
```json
{ "referralCode": "MYCODE12" }
```

**Validation**
- `referralCode`: 8–10 chars, uppercase letters or digits only (`/^[A-Z0-9]{8,10}$/`). Auto-uppercased server-side.
- Must not contain any blacklisted word (e.g. `GPSC`, `WEBSANKUL`, `PSI`, `TALATI`, `LOVE`, `SEX`, `GOOGLE`, `WHATSAPP`, `FESTIVAL50`, …full list in [referral.validation.ts:62-70](src/client/referral/referral.validation.ts#L62-L70)).
- Must be globally unique across customers.

**Response 200**
```json
{
  "success": true,
  "data": {
    "_id": "...",
    "firstName": "...",
    "lastName": "...",
    "phoneNumber": "...",
    "referralCode": "MYCODE12",
    "rewardPoints": 0
  }
}
```

**Errors**
- `400` "You can't generate referral code again." (already set)
- `400` "Referral code is not available, please try another one." (blacklist or already taken)
- `400` Zod validation errors

---

## 5. Request Withdrawal

Debits reward points and initiates a Razorpay payout to the chosen bank account.

- **Method:** `POST`
- **Path:** `/withdraw`
- **Auth:** Required

**Body**
```json
{ "bankAccountId": "<bankAccountId>", "amount": 500 }
```

**Validation**
- `bankAccountId`: required, valid ObjectId belonging to the customer.
- `amount`: positive integer.
- Minimum withdrawal: **₹500**.
- `amount` ≤ `customer.rewardPoints`.

**Flow**
1. Mongo transaction: decrement `rewardPoints` by `amount`, create a `ReferralTransaction` of type `DEBIT` with status `PENDING`, embedding a snapshot of the bank account.
2. Outside the Mongo transaction, Razorpay calls run in order: `createContact` → `createFundAccount` → `createPayout`.
3. On success, `transaction.providerRef = payout.id` is saved.
4. On payout failure, a compensating Mongo transaction refunds the points and marks the local transaction `FAILED` with `failureReason`. Returns `502`.

Final status flips (e.g. `PROCESSED`/`FAILED`) come from the Razorpay webhook keyed by `providerRef`.

**Response 201**
```json
{ "success": true, "data": { /* ReferralTransaction with providerRef */ } }
```

**Errors:** `400` validation / insufficient points / below minimum, `404` user or bank account not found, `502` payout could not be initiated.

---

## 6. Bank Accounts (payout targets)

### 6.1 List
- **Method:** `GET`
- **Path:** `/bank-accounts`
- **Auth:** Required

Returns the customer's bank accounts sorted by `createdAt` desc.

```json
{ "success": true, "data": [ /* CustomerBankAccount[] */ ] }
```

### 6.2 Create
- **Method:** `POST`
- **Path:** `/bank-accounts`
- **Auth:** Required

**Body**
```json
{
  "accountHolderName": "John Doe",
  "ifscCode": "HDFC0001234",
  "accountNumber": "123456789012",
  "confirmAccountNumber": "123456789012"
}
```

**Validation**
- `accountHolderName`: 1–150 chars (trimmed).
- `ifscCode`: matches `/^[A-Z]{4}0[A-Z0-9]{6}$/` (11 chars). Auto-uppercased.
- `accountNumber`: 9–18 digits.
- `confirmAccountNumber`: must equal `accountNumber`.
- Server resolves `ifscCode` via `lookupIfsc()` to auto-populate `bankName`, `branchName`, `city`. Invalid IFSC → `400`.

**Response 201**
```json
{ "success": true, "data": { /* CustomerBankAccount */ } }
```

### 6.3 Update
- **Method:** `PUT`
- **Path:** `/bank-accounts/:id`
- **Auth:** Required

All body fields are optional, but if `accountNumber` and `confirmAccountNumber` are both provided they must match. If `ifscCode` is sent, server re-runs IFSC lookup and updates `bankName`/`branchName`/`city`.

```json
{ "success": true, "data": { /* updated CustomerBankAccount */ } }
```

**Errors:** `400` invalid id / IFSC / validation, `404` Bank account not found.

### 6.4 Delete
- **Method:** `DELETE`
- **Path:** `/bank-accounts/:id`
- **Auth:** Required

```json
{ "success": true, "message": "Bank account deleted." }
```

**Errors:** `400` invalid id, `404` Bank account not found.

---

## 7. Refer & Earn Content

### 7.1 Terms
- **Method:** `GET`
- **Path:** `/terms`
- **Auth:** Required

Active terms ordered by `order` then `createdAt`.

```json
{ "success": true, "data": [ { "_id": "...", "text": "...", "order": 1 } ] }
```

### 7.2 FAQs
- **Method:** `GET`
- **Path:** `/faqs`
- **Auth:** Required

Active FAQs ordered by `order` then `createdAt`.

```json
{
  "success": true,
  "data": [ { "_id": "...", "question": "...", "answer": "...", "order": 1 } ]
}
```

---

## Endpoint Index

| # | Method | Path | Purpose |
|---|--------|------|---------|
| 1 | GET | `/rewards` | Rewards overview + active student program |
| 2 | GET | `/transactions` | Paginated ledger (filter by `type`) |
| 3 | GET | `/transactions/:id` | Transaction detail |
| 4 | POST | `/code/generate` | One-time referral code generation |
| 5 | POST | `/withdraw` | Initiate withdrawal payout (min ₹500) |
| 6 | GET | `/bank-accounts` | List saved bank accounts |
| 7 | POST | `/bank-accounts` | Add bank account (IFSC auto-resolved) |
| 8 | PUT | `/bank-accounts/:id` | Update bank account |
| 9 | DELETE | `/bank-accounts/:id` | Delete bank account |
| 10 | GET | `/terms` | Active T&Cs |
| 11 | GET | `/faqs` | Active FAQs |

---

## Related Source Files
- Routes: [src/client/referral/referral.routes.ts](src/client/referral/referral.routes.ts)
- Controller: [src/client/referral/referral.controller.ts](src/client/referral/referral.controller.ts)
- Content controller: [src/client/referral/content.controller.ts](src/client/referral/content.controller.ts)
- Validation: [src/client/referral/referral.validation.ts](src/client/referral/referral.validation.ts)
- Razorpay integration: [src/client/payment/razorpayx.ts](src/client/payment/razorpayx.ts)
- Mount: [src/client/client.routes.ts:64](src/client/client.routes.ts#L64)
