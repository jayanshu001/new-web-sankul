# Admin – Customer Details (aggregate)

One-shot endpoint that returns everything the admin Customer Detail page needs:
profile, addresses, all purchases across product types, and a summary block.

## Endpoint

```
GET /api/v1/admin/customers/:id/details
```

- **Auth**: Bearer token, role `admin` or `super_admin`
  (enforced by `authenticate` + `requireRole("admin", "super_admin")` on the
  router — see [customer.routes.ts:21](src/admin/customer/customer.routes.ts#L21)).
- **Path params**: `id` — Customer `_id` (Mongo ObjectId).
- **Query params**: none. This is a single aggregate fetch; per-section
  pagination still lives on the existing list endpoints
  (`/:id/course-subscriptions`, `/:id/ebook-subscriptions`, …).

## Response (200)

```jsonc
{
  "success": true,
  "data": {
    "profile": {
      "_id": "…",
      "firstName": "…", "middleName": "…", "lastName": "…",
      "phoneNumber": "…", "emailAddress": "…",
      "profilePicture": "…", "phone2": "…",
      "dob": "1998-04-12T00:00:00.000Z", "gender": "…",
      "stateId":     { "_id": "…", "name": "…", "stateCode": "…" },
      "districtId":  { "_id": "…", "name": "…" },
      "educationId": { "_id": "…", "name": "…" },
      "city": "…", "status": true, "verified": true,
      "createdAt": "…", "updatedAt": "…"
      // password / otp are stripped
    },

    "addresses": [
      {
        "_id": "…", "customerId": "…",
        "stateId": { "_id": "…", "name": "…", "stateCode": "…" },
        /* line1, line2, city, pincode, etc. */
        "createdAt": "…"
      }
    ],

    "purchases": {
      "courses": [
        {
          "_id": "…",
          "courseId":  { "_id": "…", "name": "…", "image": "…", "level": "…" },
          "packageId": { "_id": "…", "name": "…", "duration": 6, "price": 1999, "withMaterial": true },
          "paidAmount": 1999,
          "paymentStatus": "verified",   // pending | verified | failed
          "paymentMethod": "…",
          "startAt": "…", "endAt": "…",
          "status": true,
          "isActive": true,              // status && endAt > now
          "createdAt": "…"
        }
      ],

      "packages": [
        {
          "_id": "…",
          "targetPackageId": { "_id": "…", "name": "…", "image": "…" },
          "packageId":       { "_id": "…", "name": "…", "duration": 12, "price": 4999 },
          "paidAmount": 4999, "paymentStatus": "verified",
          "startAt": "…", "endAt": "…", "status": true, "isActive": true,
          "createdAt": "…"
        }
      ],

      "liveCourses": [
        {
          "_id": "…",
          "liveCourseId": { "_id": "…", "name": "…", "image": "…", "level": "…" },
          "planId":       { "_id": "…", "name": "…", "duration": 3, "price": 2999 },
          "paidAmount": 2499, "originalAmount": 2999, "discountAmount": 500,
          "paymentStatus": "verified",
          "startAt": "…", "endAt": "…", "status": true, "isActive": true,
          "createdAt": "…"
        }
      ],

      "testSeries": [
        {
          "_id": "…",
          "testSeriesId": { "_id": "…", "name": "…", "image": "…" },
          "planId":       { "_id": "…", "name": "…", "duration": 6, "price": 799 },
          "price": 799,
          "paymentType": "…",
          "startAt": "…", "endAt": "…", "status": true, "isActive": true,
          "createdAt": "…"
        }
      ],

      "ebooks": [
        {
          "_id": "…",
          "ebookId": { "_id": "…", "name": "…", "author": "…", "publisher": "…" },
          "orderId": {
            "_id": "…", "paymentMethod": "…", "orderPrice": 299,
            "status": "…", "createdAt": "…"
          },
          "price": 299,
          "paymentType": "…",
          "startAt": "…", "endAt": "…", "status": true, "isActive": true,
          "createdAt": "…"
        }
      ],

      "physicalBooks": [
        {
          "_id": "…",
          "items": [
            {
              "bookId": { "_id": "…", "name": "…", "image": "…" },
              "name": "…", "qty": 1, "price": 499, "shippingPrice": 49
            }
          ],
          "amount": 548,
          "status": "…",                 // BookOrderStatus enum
          "paymentMethod": "…",
          "paidAt": "…",
          "createdAt": "…"
        }
      ]
    },

    "summary": {
      "totals": {
        "courses": 3, "packages": 1, "liveCourses": 2,
        "testSeries": 1, "ebooks": 4, "physicalBooks": 2,
        "addresses": 1
      },
      "active": {
        "courses": 2, "packages": 1, "liveCourses": 1,
        "testSeries": 1, "ebooks": 3
      },
      "lifetimeSpend": 18342           // sum across all six purchase types
    }
  }
}
```

## Errors

| Status | Body                                             | When                                |
| ------ | ------------------------------------------------ | ----------------------------------- |
| 400    | `{ success:false, message:"Invalid Customer ID" }` | `:id` is not a valid ObjectId       |
| 401    | (from `authenticate`)                            | Missing / invalid Bearer token      |
| 403    | (from `requireRole`)                             | Caller is not admin / super_admin   |
| 404    | `{ success:false, message:"Customer not found" }` | Customer missing or soft-deleted   |
| 500    | `{ success:false, message }`                     | Unexpected error                    |

## Implementation notes

- Handler: `getCustomerDetails` in
  [customer.controller.ts](src/admin/customer/customer.controller.ts).
- Soft-deleted customers (`isAccountDeleted: true`) are treated as 404.
- Courses vs. Packages are stored in the same collection
  (`PackageCourseSubscription`); we split by which of `courseId` /
  `targetPackageId` is populated — see
  [PackageCourseSubscription.model.ts](src/models/customer/PackageCourseSubscription.model.ts).
- `isActive` on each subscription = `status === true && endAt > now`.
- `summary.lifetimeSpend` sums `paidAmount` (courses, packages, live courses),
  `price` (test series, ebooks), and `amount` (physical book orders).
- All six purchase queries plus the address query run in parallel via
  `Promise.all`.
- This endpoint is intentionally **un-paginated** — it's for a single detail
  screen. If a customer has thousands of orders, switch the UI section to its
  paginated sibling (`/:id/course-subscriptions`, `/:id/ebook-subscriptions`).
