# Refer & Earn Content — Admin APIs

CRUD endpoints for the **Terms & Conditions** and **FAQs** shown on the client's Refer & Earn screen.

- Mount: `/api/v1/admin/referrals`
- Auth: Bearer token + role `admin` or `super_admin` (inherits the existing referral router guard).

Two collections back these endpoints:
- `ws_referral_terms` — bullet list of T&C entries.
- `ws_referral_faqs` — question / answer pairs.

---

## Data models

### `ws_referral_terms`

| Field       | Type      | Notes                                      |
| ----------- | --------- | ------------------------------------------ |
| `_id`       | ObjectId  |                                            |
| `text`      | string    | Bullet text, max 1000 chars. Required.     |
| `order`     | number    | Sort key, ascending. Default `0`.          |
| `status`    | boolean   | `false` hides it from the client. Default `true`. |
| `createdAt` | Date      | Auto.                                      |
| `updatedAt` | Date      | Auto.                                      |

### `ws_referral_faqs`

| Field       | Type      | Notes                                  |
| ----------- | --------- | -------------------------------------- |
| `_id`       | ObjectId  |                                        |
| `question`  | string    | Max 500 chars. Required.               |
| `answer`    | string    | Max 5000 chars. Required.              |
| `order`     | number    | Sort key, ascending. Default `0`.      |
| `status`    | boolean   | `false` hides it from the client. Default `true`. |
| `createdAt` | Date      | Auto.                                  |
| `updatedAt` | Date      | Auto.                                  |

---

## Terms & Conditions

### `GET /api/v1/admin/referrals/terms`

Lists every term (active + inactive), sorted by `order` then `createdAt`.

```json
{
  "success": true,
  "data": [
    {
      "_id": "6a05...",
      "text": "By participating in the Refer & Earn program, you agree to the following terms and conditions.",
      "order": 0,
      "status": true,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

### `POST /api/v1/admin/referrals/terms`

```json
{
  "text": "Open to all registered users of Websankul.",
  "order": 1,
  "status": true
}
```

Returns `201` with the created doc. Only `text` is required.

### `GET /api/v1/admin/referrals/terms/:id`
### `PUT /api/v1/admin/referrals/terms/:id`

Partial update — any subset of `text`, `order`, `status`.

### `DELETE /api/v1/admin/referrals/terms/:id`

```json
{ "success": true, "message": "Term deleted." }
```

---

## FAQs

### `GET /api/v1/admin/referrals/faqs`

Lists every FAQ (active + inactive), sorted by `order` then `createdAt`.

```json
{
  "success": true,
  "data": [
    {
      "_id": "6a05...",
      "question": "How do I upgrade my subscription plan?",
      "answer": "You can upgrade your plan by going to My Subscriptions > Manage Plan > Upgrade. Choose your preferred plan and complete the payment process.",
      "order": 0,
      "status": true,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

### `POST /api/v1/admin/referrals/faqs`

```json
{
  "question": "How do I upgrade my subscription plan?",
  "answer": "You can upgrade your plan by going to My Subscriptions > Manage Plan > Upgrade. Choose your preferred plan and complete the payment process.",
  "order": 0,
  "status": true
}
```

`question` and `answer` required; `order` and `status` optional.

### `GET /api/v1/admin/referrals/faqs/:id`
### `PUT /api/v1/admin/referrals/faqs/:id`

Partial update.

### `DELETE /api/v1/admin/referrals/faqs/:id`

```json
{ "success": true, "message": "FAQ deleted." }
```

---

## Errors

- `400` — invalid id or zod validation failure (returns `{ success: false, errors: [...] }`).
- `404` — term/FAQ not found.
- `500` — unexpected.
