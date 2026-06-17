# Remaining MongoDB Reads — Path to SQL-Only

> Snapshot: 2026-06-17. Tracks everywhere the app still reads/writes **MongoDB**
> so we can drive to "all API data from SQL". Two kinds of work:
> **(A) flip** — SQL branch exists, just not enabled; **(B) build** — no SQL
> branch yet (hardwired to Mongoose).

## Status legend
- ✅ **On SQL** — key in `MIGRATION_MYSQL_MODULES`, served from MySQL.
- 🟡 **Ready, off** — SQL branch complete; blocked or awaiting flip.
- 🔴 **Mongo-only** — no SQL branch; needs to be built.

---

## ✅ Already on SQL (enabled)
admin-auth, customer-auth, customer-lookups, customer-profile,
customer-bank-account, app-update, version, faq, banner-slider, testimonial,
department, terms, popup, offline-city, catalog-* (package-type, course, video,
ebook, exam, material, book), offline-batch, commerce-* (price, subscription,
ebook-sub, promoter, promocode, educator, order), ebook-order, book-order,
offline-enquiry, package-chat.

Plus (no flag, migrated directly): **admin administrator CRUD**, **admin customer CRUD**.

---

## 🟡 Ready but not enabled

| Module | Blocker | Action |
|---|---|---|
| `customer-address` | Depends on `offline-city` id-space (cityId ↔ OfflineCity). SQL branch complete on both sides. | Enable together with / after offline-city is confirmed; then flip. |

---

## 🔴 Mongo-only — needs a SQL branch (build work)

### Client-side customer features
| File | Functions | Mongo models | Notes |
|---|---|---|---|
| `src/client/goal/goal.client.service.ts` | myGoals, getAllGoals, getGoalsByIds | Goal | Map to `ws_customer_target_goal`. Profile already hydrates goals from SQL — reuse that repo. |
| `src/client/referral/referral.controller.ts` | getRewardsOverview, getMyTransactions, getTransactionById, requestWithdrawal, generateReferralCode | Customer, ReferralTransaction, CustomerBankAccount | **Partial**: bank-account ops already SQL; rewards/transactions/withdrawal/code are Mongo. Tables: `ws_customer`, `ws_refferal_transaction`. Withdrawal uses a Mongo session + Razorpay payout. |
| `src/client/cart/cart.controller.ts` | addToCart, updateCartItemQty, removeCartItem, getCart | BookCart, Book, BookOrder | Tables: `ws_book_cart`, etc. |
| `src/client/orders/orders.controller.ts` | order list/detail referral lookup | Customer | `Customer.findOne({ referralCode })`. |
| `src/client/promocode/promocode.controller.ts` | list/apply | PromoCode, Customer | Commerce-promocode is on SQL for admin; client apply path still hits Mongo customer. |

### Admin features
| File | Functions | Mongo models | Notes |
|---|---|---|---|
| `src/admin/dashboard/dashboard.controller.ts` | customer counts/active stats | Customer | `find` + `countDocuments`. Straightforward `prisma.customer.count`. |
| `src/admin/notification/notification.controller.ts` | createNotification + dispatch | Notification, ImageNotification | Audience snapshot. |
| `src/admin/notification/audience.ts` | audience resolution | Customer + subscriptions | Targets by course/platform/explicit ids. |
| `src/admin/notification/dispatcher.ts` | dispatchAudience, dispatchNotification | Customer, Notification | Feeds FCM. |
| `src/admin/livechat/livechat.controller.ts` | history, send, ban | LiveChatMessage, LiveChatBan, Customer | |

### Educator
| File | Area | Mongo models | Status |
|---|---|---|---|
| `src/educator/auth/educator.auth.service.ts` | auth | ~~Mongo~~ → **SQL** (ws_course_educator + ws_educator_access_tokens) | ✅ migrated 2026-06-17 (MD5+bcrypt) |
| `src/educator/dashboard/dashboard.controller.ts` | dashboard | Course, Package, PackageCourseSubscription, Customer | 🔴 blocked on subscription models |
| `src/educator/course/course.controller.ts` | course CRUD | Course, PackageCourseEbookPrice, PackageCourseSubscription, Customer | 🔴 |
| `src/educator/package/package.controller.ts` | packages | Package, PackageCourseEbookPrice, PackageCourseSubscription, Customer | 🔴 |

### Promoter
| File | Area | Mongo models |
|---|---|---|
| `src/promoter/auth/promoter.auth.service.ts` | auth | Promoter, PromoterAccessToken (`model_type=App\\Models\\Promoter`) |
| `src/promoter/dashboard/dashboard.controller.ts` + `overview.service.ts` | dashboard | Promoter, ReferralTransaction, Customer |
| `src/promoter/customer/customer.controller.ts` | customer list/detail | Customer, Promoter |
| `src/promoter/subscription/subscription.controller.ts` | subscriptions | PackageCourseSubscription, Customer |

### Infrastructure / cross-cutting
| File | Area | Mongo models | Notes |
|---|---|---|---|
| `src/utils/fcm.ts` | FCM delivery tracking | Customer | `updateMany` device/read status. |
| `src/webhooks/razorpay-payout.controller.ts` | payout webhook | ReferralTransaction, Customer | |
| `src/socket/livechat.socket.ts` | live chat realtime | Customer, LiveChatMessage | WebSocket; auth context + history + create. |
| `src/libs/core/generate.ts` | ref-code/seq generation | generic | Used by orders/referral. |
| `src/utils/pdfCourseReceipt.ts` | receipt PDF | Customer | |

### Blocked on un-migrated models (admin customer detail)
The admin customer CRUD is on SQL, but its **aggregate** handlers
(`getCustomerCourseSubscriptions`, `getCustomerEbookSubscriptions`,
`getCustomerAddresses`, `getCustomerDetails`) return empty on the SQL branch
because these models aren't migrated yet: PackageCourseSubscription,
LiveCourseSubscription, TestSeriesSubscription, EbookSubscription, BookOrder,
CustomerAddress (admin view). Fill these once those subscription/order modules
have SQL branches.

---

## Suggested order
1. **Cheap wins (count/lookup only):** admin dashboard counts, orders referral lookup, client goals → reuse existing SQL repos.
2. **Referral system** (client + webhook + promoter share `ws_refferal_transaction` + `ws_customer`): migrate together.
3. **Educator & Promoter auth**: mirror the admin-auth (ws_users) pattern exactly — token table + spatie pivots with their `model_type`.
4. **Notifications + FCM + livechat**: audience/dispatch + sockets; larger, do after the customer/referral core is fully SQL.
5. **Subscription/order models**: unblocks the admin customer detail aggregates.
6. **Flip `customer-address`** once offline-city id-space is confirmed.
