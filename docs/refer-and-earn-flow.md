# Refer & Earn — End-to-End Flow

Complete lifecycle of the Refer & Earn feature: which screens fire which APIs, how the data flows through our DB, and how Razorpay closes the loop.

For full request/response schemas of the *new* APIs, see [client-referral-new-apis.md](./client-referral-new-apis.md). This doc focuses on **how the pieces fit together**.

---

## Endpoint map (one place for all of them)

All routes are mounted under `/api/v1/client/referral` and require `Authorization: Bearer <token>`. The single exception is the webhook — it lives at the top-level `/api/v1/webhooks/...` and is authenticated by HMAC signature instead.

| Method | Path                              | Purpose                                       | Status     |
| ------ | --------------------------------- | --------------------------------------------- | ---------- |
| GET    | `/rewards`                        | Wallet balance + program info                 | existing   |
| GET    | `/transactions?page&limit&type`   | Paginated transaction history                 | existing   |
| GET    | `/transactions/:id`               | Single transaction detail (UTR, failure reason) | **new**  |
| POST   | `/code/generate`                  | One-time create personal referral code        | existing   |
| POST   | `/withdraw`                       | Initiate bank transfer (deduct + Razorpay payout) | updated |
| GET    | `/bank-accounts`                  | List saved bank accounts                      | existing   |
| POST   | `/bank-accounts`                  | Add a bank account (IFSC verified via Razorpay) | existing |
| PUT    | `/bank-accounts/:id`              | Edit a bank account                           | existing   |
| DELETE | `/bank-accounts/:id`              | Remove a bank account                         | existing   |
| GET    | `/terms`                          | Refer & Earn terms (CMS-driven)               | existing   |
| GET    | `/faqs`                           | Refer & Earn FAQs (CMS-driven)                | existing   |
| POST   | `/api/v1/webhooks/razorpay-payout`| Razorpay → us, payout status updates          | **new**    |

---

## Environment variables

| Var                                | Used by                                  | Notes                                      |
| ---------------------------------- | ---------------------------------------- | ------------------------------------------ |
| `RAZORPAY_KEY_ID`                  | Payments + RazorpayX HTTP auth           | shared with the rest of the app            |
| `RAZORPAY_KEY_SECRET`              | Payments + RazorpayX HTTP auth           | shared with the rest of the app            |
| `RAZORPAYX_ACCOUNT_NUMBER`         | `POST /withdraw` (payout creation)       | your X virtual account number              |
| `RAZORPAY_PAYOUT_WEBHOOK_SECRET`   | `POST /webhooks/razorpay-payout`         | must match the Razorpay dashboard config   |

---

## Screen-by-screen mapping

The screen numbers refer to the design file (7 screens, left → right).

### Screen 1 — Refer & Earn landing (no code yet)

User opens the tab for the first time.

**On mount**
- `GET /referral/rewards` → balance + program info (drives "Refer a friend, earn up to ₹50,000")
- `GET /referral/transactions?page=1&limit=20` → empty on first visit ("No Transactions Found")
- `GET /referral/terms`, `GET /referral/faqs` → bottom cards

**Button state:** "Generate Your Promo Code" is enabled because `customer.referralCode` is `null`.

---

### Screen 2 — Create your personalised code

User types `USER12345678` and taps **Generate Your Code**.

**On submit**
- `POST /referral/code/generate` with `{ "referralCode": "USER12345678" }`

Server enforces:
- Format: 6–10 chars, uppercase letters + digits only (zod schema)
- One-time: rejects if `customer.referralCode` already exists
- Blacklist check (`BLACKLISTED_REFERRAL_WORDS`)
- Uniqueness (Mongo unique index)

On success → screen flips to Screen 3.

---

### Screen 3 — Refer & Earn (code generated, no balance)

Same APIs as Screen 1, but the response from `/rewards` now contains `referralCode`. The UI swaps the **Generate** button for a chip showing the code + WhatsApp/Copy share actions. **Redeem Now** is pure navigation to Screen 4.

---

### Screen 4 — My Rewards (₹5 balance, can't withdraw yet)

- `GET /referral/rewards` → `rewardPoints: 5`
- `GET /referral/transactions` → empty

**Transfer To Bank Account** is disabled **client-side** because `rewardPoints (5) < MIN_WITHDRAWAL_AMOUNT (500)`. No server enforcement at this point — the user can't fire `/withdraw` because the button is greyed out.

---

### Screen 5 — My Rewards (₹1500, ready to withdraw)

Same two APIs as Screen 4. Now:

- `rewardPoints: 1500`
- Quick-withdraw chips (₹500 / ₹1000 / ₹1500) are computed client-side from balance
- **Transfer To Bank Account** is enabled
- Transactions list shows real rows with status badges + UTR

**Tap a transaction row** → `GET /referral/transactions/:id` for the detail view (status, UTR, failure reason).

**Tap Transfer To Bank Account** → navigate to Screen 6.

---

### Screen 6 — Bank Details (no bank yet)

- `GET /referral/bank-accounts` → `[]`

User taps **Add Bank Account +** → form opens.

**Form submit**
- `POST /referral/bank-accounts` with `{ accountHolderName, ifscCode, accountNumber, confirmAccountNumber }`

Server:
1. Zod validates format (IFSC regex, account number 9–18 digits, confirm match)
2. Calls `lookupIfsc()` against `ifsc.razorpay.com`
3. Stores `bankName`, `branchName`, `city` from the IFSC response — that's why the row later renders as "HDFC Bank" without the app sending it

**Test IFSC** for QA: `AAAA0AAAAAA` — bypasses the Razorpay lookup and returns stub data.

---

### Screen 7 — Bank Details (bank added, ready to transfer)

- `GET /referral/bank-accounts` → one row with `bankName: "HDFC Bank"`, `accountNumber: "...4821"`

User selects the radio and taps **Transfer To Bank**.

**On tap**
- `POST /referral/withdraw` with `{ bankAccountId, amount }`

What happens server-side:

1. **Validate** — amount ≥ 500, amount ≤ balance, bank belongs to user
2. **Mongo transaction A** — deduct coins from `Customer.rewardPoints`, create `ReferralTransaction` with `status: pending`, `coin: amount`, `bankAccount: <snapshot>`
3. **RazorpayX calls** (outside Mongo transaction, so a network error doesn't roll back the deduction prematurely):
   - `POST /contacts` → contact id
   - `POST /fund_accounts` → fund account id
   - `POST /payouts` → IMPS payout, returns `payout.id`
4. **Save** `transaction.providerRef = payout.id` — this is the key the webhook will use later
5. **Return** `201` with the transaction; row appears in the list as **Pending** (yellow badge)

**On Razorpay failure** (any of the three calls throw):
- Mongo transaction B refunds coins to `Customer.rewardPoints`
- `transaction.status = failed`, `failureReason` set from Razorpay error
- API returns `502 { success: false, message: "Withdrawal could not be initiated. Please try again." }`

No stuck "Pending" rows from network errors.

---

### After the app closes — Razorpay → us

Razorpay processes the IMPS payout asynchronously (seconds, usually).

**Inbound webhook**
- `POST /api/v1/webhooks/razorpay-payout`
- Headers: `X-Razorpay-Signature: <hmac>`
- Body: `{ event: "payout.processed", payload: { payout: { entity: { id, utr, ... } } } }`

Server flow:
1. Verify HMAC SHA-256 of raw body against `RAZORPAY_PAYOUT_WEBHOOK_SECRET`. Mismatch → `401`.
2. Find `ReferralTransaction` by `providerRef === payout.entity.id`. Unknown → `200 { ignored: true }` (so Razorpay stops retrying).
3. If transaction is already terminal (`successful` / `failed`) → `200 { alreadyProcessed: true }` (idempotency).
4. **Success path:** `status: successful`, store `utr`, save `providerPayload` for audit.
5. **Failure path:** Mongo transaction — refund coins + `status: failed` + `failureReason`.

Next time the user pulls-to-refresh on Screen 5, `GET /referral/transactions` returns the updated row.

---

## Sequence diagram (happy path)

```
App                   API Server                Mongo                  RazorpayX
 │                        │                       │                         │
 │ POST /withdraw         │                       │                         │
 ├───────────────────────►│                       │                         │
 │                        │ deduct + create txn   │                         │
 │                        ├──────────────────────►│                         │
 │                        │◄──────────────────────┤                         │
 │                        │                       │                         │
 │                        │ POST /contacts        │                         │
 │                        ├─────────────────────────────────────────────────►│
 │                        │ POST /fund_accounts   │                         │
 │                        ├─────────────────────────────────────────────────►│
 │                        │ POST /payouts         │                         │
 │                        ├─────────────────────────────────────────────────►│
 │                        │◄─ payout.id ───────────────────────────────────┤
 │                        │ save providerRef      │                         │
 │                        ├──────────────────────►│                         │
 │ 201 (pending)          │                       │                         │
 │◄───────────────────────┤                       │                         │
 │                                                                          │
 │            ··· user closes app, Razorpay processes payout ···           │
 │                                                                          │
 │                        │       POST /webhooks/razorpay-payout            │
 │                        │◄────────────────────────────────────────────────┤
 │                        │ verify HMAC           │                         │
 │                        │ find by providerRef   │                         │
 │                        ├──────────────────────►│                         │
 │                        │ mark successful + utr │                         │
 │                        ├──────────────────────►│                         │
 │                        │ 200 OK                │                         │
 │                        ├─────────────────────────────────────────────────►│
```

---

## Error states (what the UI sees)

| Trigger                                     | API response                                  | UI behavior                                 |
| ------------------------------------------- | --------------------------------------------- | ------------------------------------------- |
| Withdraw amount < 500                       | `400` + message                               | Inline error on amount field                |
| Withdraw amount > balance                   | `400` + message                               | Inline error                                |
| Bank account doesn't belong to user         | `404 "Bank account not found."`               | Toast / re-fetch list                       |
| Razorpay contact/fund/payout call fails     | `502` + coins refunded                        | Toast "Withdrawal could not be initiated."  |
| IFSC invalid (add bank flow)                | `400 "Invalid IFSC code."`                    | Inline error on IFSC field                  |
| Payout rejected after webhook                | (no API to UI — txn row shows `failed` next refresh) | Red badge + `failureReason` on tap   |
| Webhook bad signature                       | `401` (Razorpay retries; user never sees)     | —                                           |
| Duplicate webhook delivery                  | `200 { alreadyProcessed: true }`              | —                                           |

---

## Data model snapshot

`ReferralTransaction` (key fields):

```
_id, customerId, bankAccount (snapshot),
description, coin, type (credit|debit),
status (pending|successful|failed),
utr, failureReason, providerRef, providerPayload,
createdAt, updatedAt
```

`Customer.rewardPoints` is the wallet balance — incremented on referral credits, decremented on `/withdraw`, refunded on Razorpay failure.

`CustomerBankAccount`: `accountHolderName, ifscCode, accountNumber, bankName, branchName, city` — last three are populated from Razorpay's IFSC API at create time.

---

## Operational checklist before going live

- [ ] `RAZORPAYX_ACCOUNT_NUMBER` set in production env
- [ ] `RAZORPAY_PAYOUT_WEBHOOK_SECRET` set in production env, matching the value pasted into Razorpay dashboard
- [ ] Webhook URL registered in Razorpay: `https://<prod-domain>/api/v1/webhooks/razorpay-payout`
- [ ] All four payout events ticked in dashboard: `payout.processed`, `payout.failed`, `payout.reversed`, `payout.rejected`
- [ ] RazorpayX virtual account funded (or `queue_if_low_balance` accepted as a fallback)
- [ ] Test withdrawal on staging end-to-end: webhook reaches the server, signature verifies, txn flips to `successful` with UTR
