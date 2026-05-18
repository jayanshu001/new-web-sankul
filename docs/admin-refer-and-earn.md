# Refer & Earn — Admin Management

Companion to [refer-and-earn-flow.md](./refer-and-earn-flow.md) (client side) and [client-referral-new-apis.md](./client-referral-new-apis.md) (new client APIs).

This doc covers the admin surface for managing the Refer & Earn programme: referrers, withdrawals, payouts, manual adjustments, and CMS content.

All routes are mounted under `/api/v1/admin/referrals` and require:

```
Authorization: Bearer <admin-token>
```

…plus the role guard `requireRole("admin", "super_admin")` ([src/admin/referral/referral.routes.ts:30](src/admin/referral/referral.routes.ts#L30)).

---

## 1. What already exists

These endpoints are live today. Documenting them here because they were undocumented.

### 1.1 Programs (the "earn up to ₹X" config)

| Method | Path                       | Purpose                                            |
| ------ | -------------------------- | -------------------------------------------------- |
| GET    | `/programs`                | List all referral programs                         |
| POST   | `/programs`                | Create a program (e.g. student, premium)           |
| GET    | `/programs/:id`            | Single program                                     |
| PUT    | `/programs/:id`            | Update reward amounts / status                     |
| DELETE | `/programs/:id`            | Remove a program                                   |

The client side reads these via `GET /client/referral/rewards` (`program` array in the response).

### 1.2 Transactions (the unified ledger)

`GET /transactions` — paginated list of all `ReferralTransaction` rows across all customers.

**Query params**

| Param        | Values                                | Notes                                |
| ------------ | ------------------------------------- | ------------------------------------ |
| `customerId` | ObjectId                              | Filter to one customer               |
| `type`       | `credit` \| `debit`                   | Earning vs withdrawal                |
| `status`     | `pending` \| `successful` \| `failed` | Withdrawal state — **see gap §2.2**  |
| `fromDate`   | ISO date                              | `createdAt >=`                       |
| `toDate`     | ISO date                              | `createdAt <=`                       |
| `page`       | int (default 1)                       |                                      |
| `limit`      | int (default 20)                      |                                      |

Returns each row with `customerId` populated as `{ _id, firstName, lastName, phoneNumber, emailAddress, referralCode }`.

**Mutations**

| Method | Path                                  | Purpose                                         |
| ------ | ------------------------------------- | ----------------------------------------------- |
| PATCH  | `/transactions/:id/status`            | Manually flip a debit's status (legacy escape hatch) |
| POST   | `/transactions/:id/reject`            | Reject a `pending` withdrawal → refunds coins, deletes the row |

> **Caveat:** `updateWithdrawalStatus` predates the Razorpay webhook. With Razorpay live, prefer letting the webhook drive status. Use this endpoint only for stuck rows that never received a webhook.

### 1.3 Withdrawal Report (admin "Referral Report" screen)

`GET /withdrawals` — paginated listing shaped for the admin Referral Report table (Date, Account Holder Name, IFSC Code, Account Number, Coin, Referral Code, Customer Name, Customer Phone). Joins `ReferralTransaction` (type=DEBIT, has embedded `bankAccount`) with `Customer` in a single aggregation.

**Query params**

| Name       | Type     | Default | Notes                                                                              |
|------------|----------|---------|------------------------------------------------------------------------------------|
| `fromDate` | ISO date | —       | Inclusive lower bound on `createdAt`                                               |
| `toDate`   | ISO date | —       | Inclusive upper bound (end-of-day applied server-side)                             |
| `status`   | enum     | —       | `pending` \| `successful` \| `failed`                                              |
| `search`   | string   | —       | Case-insensitive match on holder name, account number, IFSC, customer first/last name, phone, referral code |
| `page`     | number   | `1`     | Page number                                                                        |
| `limit`    | number   | `10`    | Page size (matches the screenshot's "Show 10 rows")                                |

**Response 200**

```json
{
  "success": true,
  "data": [
    {
      "_id": "txn_...",
      "date": "2026-05-18T07:12:00Z",
      "accountHolderName": "John Doe",
      "ifscCode": "HDFC0001234",
      "accountNumber": "123456789012",
      "bankName": "HDFC Bank",
      "branchName": "Andheri West",
      "coin": 1500,
      "status": "pending",
      "providerRef": "pout_xxx",
      "failureReason": null,
      "referralCode": "JOHN1234",
      "customerId": "cust_...",
      "customerName": "John Doe",
      "customerPhone": "9876543210"
    }
  ],
  "pagination": { "total": 0, "page": 1, "limit": 10, "totalPages": 0 }
}
```

> **Why this exists separate from `/transactions`:** `/transactions` returns the full ledger (credits + debits, with full Mongo docs). The Referral Report screen needs only **withdrawal rows** (DEBIT with bank account), flattened to one row per request with the customer's name/phone/referral-code joined in — matching the table columns 1:1. No client-side reshaping needed.

### 1.4 CSV export

`GET /withdrawals/csv` — streams all debit transactions as CSV for accounting. This is what the "Export to csv" button on the Referral Report screen calls.

Accepts `fromDate`, `toDate`, `status` filters (same semantics as `/withdrawals`).

### 1.5 Manual reward adjustment

`POST /customers/:customerId/rewards` — adjust a single customer's `rewardPoints` balance, audit-logged as a `ReferralTransaction`.

**Body**
```json
{
  "amount": 250,
  "type": "credit",
  "description": "Compensation for failed payout incident on 2026-05-12"
}
```

Use cases: comp credits, correcting bad data, removing fraudulent earnings.

### 1.5 Terms & FAQs CMS

| Method | Path             | Purpose                       |
| ------ | ---------------- | ----------------------------- |
| GET    | `/terms`         | List all T&C entries          |
| POST   | `/terms`         | Create                        |
| GET    | `/terms/:id`     | Single entry                  |
| PUT    | `/terms/:id`     | Update                        |
| DELETE | `/terms/:id`     | Remove                        |
| (same shape for `/faqs`)              |                               |

Client side reads via `GET /client/referral/terms` and `/faqs`.

---

## 2. Gaps — what's missing for proper management

These don't exist yet. Below is the recommended spec for each. **Doc only — no code in this pass.**

### 2.1 Referrers listing — "all users who have a promo code" ✅ **BUILT**

```
GET /api/v1/admin/referrals/referrers
```

**Query params**

| Param           | Values                  | Purpose                                                            |
| --------------- | ----------------------- | ------------------------------------------------------------------ |
| `search`        | string                  | Match on `referralCode`, `firstName`, `lastName`, `phoneNumber`, `emailAddress` |
| `sort`          | `earned` \| `withdrawn` \| `balance` \| `createdAt` | Default `earned` desc                       |
| `hasWithdrawn`  | `true` \| `false`       | Filter to users who have ever withdrawn (or never)                 |
| `minEarned`     | int                     | Show only top earners                                              |
| `page` / `limit`| int                     | Standard pagination                                                |

**Response shape (per row)**

```json
{
  "customerId": "65a1...",
  "firstName": "Yug",
  "lastName": "Patel",
  "phoneNumber": "+919...",
  "emailAddress": "yug@example.com",
  "referralCode": "USER12345678",
  "referralCodeCreatedAt": "2026-04-10T12:00:00Z",
  "rewardPoints": 1500,
  "stats": {
    "totalEarned": 3500,
    "totalWithdrawn": 2000,
    "pendingWithdrawals": 0,
    "failedWithdrawals": 1,
    "successfulWithdrawals": 4,
    "lastWithdrawalAt": "2026-05-10T05:02:00Z"
  }
}
```

> **Note:** `referredCount` (number of users who signed up using this code) was originally proposed but not built — `Customer` has no `referredBy` field, so the inviter relation isn't tracked anywhere today. If/when you add that field, the aggregation can be extended trivially.

### 2.2 Filter transactions by `failed` status ✅ **BUILT**

`GET /transactions?status=failed` is now accepted in both the listing and the CSV export.

### 2.3 Lookup by Razorpay payout id

Ops scenario: Razorpay support says "payout `pout_NA1bcd2efgh3` failed for unknown reason." Today there's no API to find the matching internal transaction without a DB query.

**Recommended endpoint**

```
GET /api/v1/admin/referrals/transactions/by-provider-ref/:providerRef
```

Returns the single `ReferralTransaction` with `providerRef === <id>`, populated with customer + bank snapshot.

### 2.4 Retry / re-issue a failed payout

Today, when Razorpay marks a payout `failed`, the webhook refunds coins and sets `status: failed`. The user has to re-initiate themselves. Ops can't manually retry on behalf of a user (e.g. after fixing a wrong account number).

**Recommended endpoint**

```
POST /api/v1/admin/referrals/transactions/:id/retry-payout
```

**Behaviour**
- Only allowed when `status === failed` and `type === debit`.
- Re-deducts coins (idempotently — checks current balance), creates a fresh `ReferralTransaction` linked back to the original via `retryOf`, fires the same Razorpay payout flow.
- Returns the new transaction.

**Schema change required:** add `retryOf?: ObjectId` to `ReferralTransaction` for traceability.

### 2.5 Programme-wide overview / dashboard

For a single-screen admin overview ("how is Refer & Earn doing this month?").

**Recommended endpoint**

```
GET /api/v1/admin/referrals/overview?from=2026-05-01&to=2026-05-31
```

**Response**

```json
{
  "success": true,
  "data": {
    "period": { "from": "2026-05-01", "to": "2026-05-31" },
    "referrers": {
      "total": 1245,
      "newInPeriod": 80
    },
    "earnings": {
      "totalCreditedInPeriod": 152000,
      "totalWithdrawnInPeriod": 98000,
      "currentLiability": 480000
    },
    "withdrawals": {
      "pending": { "count": 12, "amount": 18500 },
      "successful": { "count": 245, "amount": 198000 },
      "failed": { "count": 4, "amount": 3200 }
    },
    "topReferrers": [
      { "customerId": "65a1...", "name": "Yug Patel", "earned": 12000 }
    ]
  }
}
```

`currentLiability` = sum of all `Customer.rewardPoints` — the rupee value sitting in user wallets that we owe.

### 2.6 Revoke a referral code

Today, once a user generates a code, it's permanent. Admin has no way to revoke it (for abuse, typo, etc.).

**Recommended endpoint**

```
DELETE /api/v1/admin/referrals/customers/:customerId/code
```

Sets `customer.referralCode = null`. Existing transactions are untouched. Customer can generate a new code afterwards.

Audit log: insert a `ReferralTransaction` with `type=credit, coin=0, description="Code <X> revoked by admin <Y>"` — using the ledger as a paper trail.

---

## 3. Suggested admin UI sections (informational)

How an admin dashboard would consume these endpoints:

| Section                  | Primary endpoints                                                |
| ------------------------ | ---------------------------------------------------------------- |
| **Overview** (top tab)   | `GET /overview`                                                  |
| **Referrers**            | `GET /referrers` + drill-down to `GET /transactions?customerId=` |
| **Withdrawals queue**    | `GET /transactions?type=debit&status=pending`                    |
| **Failed payouts**       | `GET /transactions?type=debit&status=failed`, then `POST /transactions/:id/retry-payout` |
| **Ledger**               | `GET /transactions` with full filters + `GET /withdrawals/csv`   |
| **Manual ops**           | `POST /customers/:id/rewards`, `DELETE /customers/:id/code`      |
| **Programs**             | `/programs` CRUD                                                 |
| **Terms / FAQs**         | `/terms` and `/faqs` CRUD                                        |

---

## 4. Permissions matrix

Today everything is gated by `requireRole("admin", "super_admin")`. As you grow ops, consider splitting:

| Action                              | `admin` | `super_admin` | `finance` (proposed) |
| ----------------------------------- | :-----: | :-----------: | :------------------: |
| View referrers / transactions / CSV |   ✅    |      ✅       |          ✅          |
| Manage programs / terms / FAQs      |   ✅    |      ✅       |          ❌          |
| Manual reward adjustment            |   ❌    |      ✅       |          ✅          |
| Revoke referral code                |   ❌    |      ✅       |          ❌          |
| Retry / reject withdrawal           |   ❌    |      ✅       |          ✅          |

Not required for the first cut — flagging it as a follow-up.

---

## 5. Implementation status

| Item                              | Status     |
| --------------------------------- | ---------- |
| §2.1 Referrers listing            | ✅ Built   |
| §2.2 Failed status filter         | ✅ Built   |
| §2.3 Lookup by `providerRef`      | Deferred   |
| §2.4 Retry failed payout          | Deferred   |
| §2.5 Programme overview           | Deferred   |
| §2.6 Revoke referral code         | Deferred   |

The deferred items are spec'd above and can be picked up when the need surfaces (Razorpay support ticket, admin dashboard request, abuse incident, etc.).
