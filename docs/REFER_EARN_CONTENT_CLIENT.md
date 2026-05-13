# Refer & Earn Content — Client APIs

Read-only endpoints powering the **Terms & Conditions** and **FAQs** cards on the Refer & Earn screen.

- Mount: `/api/v1/client/referral`
- Auth: Bearer token (inherits the existing client referral router guard).
- Only `status: true` rows are returned; ordering is `order` asc, then `createdAt` asc.

---

## `GET /api/v1/client/referral/terms`

Terms shown as a bullet list in the "Terms & Conditions" card.

### Response

```json
{
  "success": true,
  "data": [
    {
      "_id": "6a05...",
      "text": "By participating in the Refer & Earn program, you agree to the following terms and conditions.",
      "order": 0
    },
    {
      "_id": "6a05...",
      "text": "Open to all registered users of Websankul.",
      "order": 1
    },
    {
      "_id": "6a05...",
      "text": "Each user can generate only one promocode.",
      "order": 2
    }
  ]
}
```

Render each `text` as a separate bullet. The client does not need to filter — inactive rows are already excluded.

---

## `GET /api/v1/client/referral/faqs`

FAQ Q&A pairs for the "FAQs" accordion card.

### Response

```json
{
  "success": true,
  "data": [
    {
      "_id": "6a05...",
      "question": "How do I upgrade my subscription plan?",
      "answer": "You can upgrade your plan by going to My Subscriptions > Manage Plan > Upgrade. Choose your preferred plan and complete the payment process.",
      "order": 0
    },
    {
      "_id": "6a05...",
      "question": "How do I upgrade my subscription plan?",
      "answer": "...",
      "order": 1
    }
  ]
}
```

Each row maps 1:1 to an accordion item: collapsed shows `question`, expanded shows `answer`.

---

## Errors

- `401` — missing/invalid Bearer token.
- `500` — unexpected.
