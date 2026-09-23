# Local DB Table Inventory — `websankul_staging_1`

Scanned 2026-07-25 against the local `ws-mysql` container (port 3307).

- **132 tables** in the database
- **126 models** in `prisma/schema.prisma` → 125 of them map to a table that exists locally
- **7 tables** have no Prisma model at all
- **1 Prisma model has no local table** (see Findings)

Row counts below are exact `COUNT(*)`, not `information_schema` estimates. "Refs" =
`prisma.<accessor>` call sites across `src/` + `scripts/`.

---

## 1. Findings first

### 1a. Tables with no Prisma model — legacy Laravel residue

The pre-rewrite system was Laravel. These are its framework tables, carried over by the
DB dump and never modelled:

| Table | Rows | What it was for | Verdict |
|---|---|---|---|
| `ws_migrations` | 10 | Laravel migration ledger (`2014_10_12_..._create_users_table`, …) | **Dead** — superseded by `_ddl_migrations` |
| `ws_failed_jobs` | 0 | Laravel queue failure log | **Dead** — jobs are BullMQ/Redis now |
| `ws_password_resets` | 0 | Laravel password-reset tokens | **Dead** — reset flow is OTP-based (`ws_customer_otp`) |
| `ws_personal_access_tokens` | 0 | Laravel Sanctum tokens | **Dead** — JWT key ring + `ws_*_access_token(s)` now |
| `ws_tag` | 0 | Content tagging (`tag_name`/`tag_count`/`tag_image`/`tag_featured`) | **Dead** — no tagging feature exists in the rewrite |

### 1b. Tables with no Prisma model — but genuinely ours

| Table | Rows | Purpose | Verdict |
|---|---|---|---|
| `_ddl_migrations` | 56 | DDL apply ledger, written by `scripts/apply-ddl.ts` | **Live** — intentionally outside Prisma |
| `_ist_backfill` | 1 | Resume checkpoint for `scripts/backfill-ist-timestamps.ts` (PK-batched IST backfill) | **Live** — tooling state |

### 1c. Modelled but never called from code

| Table | Rows | Model | Refs | Note |
|---|---|---|---|---|
| `ws_dynamic_image` | 1 | `DynamicImage` | **0** | Single column `logo`, holding one gpsconline.com logo URL. Legacy site-logo setting. No route, no service, no repository touches it. **Strongest deletion candidate that still has a Prisma model.** |

### 1d. ⚠️ Code references a table that does not exist locally

`prisma.educatorAccessToken` → `ws_educator_access_tokens` is called in
`src/modules/educator-auth/educator-auth.repository.ts` (create / findFirst / update /
updateMany, 5+ sites) — but **no such table exists in the local DB**. Educator login and
token revocation will throw at runtime on this machine. Either the DDL was never applied
locally, or it is missing from the deploy set. This is a real gap, not an unused table.

### 1e. Empty but wired up (feature exists, no local data)

Not unused — these have live code paths and just have no staging rows:

`ws_activity_log` (8 refs) · `ws_course_book` (7) · `ws_current_affair` (12) ·
`ws_live_chat_ban` (4) · `ws_model_has_permissions` (4) · `ws_package_chat` (6) ·
`ws_promoter_access_tokens` (4) · `ws_refferal_faq` (7) · `ws_refferal_term` (7) ·
`ws_social_link` (11) · `ws_social_link_type` (10) · `ws_wishlist` (5)

Worth a second look only for `ws_social_link` / `ws_social_link_type` (11+10 refs but
zero rows in a DB that otherwise has seeded masters) and `ws_package_chat` (the
package-chat module exists but the table has never been written).

---

## 2. Full inventory by domain

### Identity & customers
| Table | Rows | Built for |
|---|---|---|
| `ws_customer` | 31 | The customer record; also holds `referral_code` and the composite `goal` JSON selection |
| `ws_customer_otp` | 171 | SMS/email OTP challenges for login + verification |
| `ws_customer_access_token` | 162 | Issued refresh/access token records, used for revocation |
| `ws_customer_address` | 7 | Shipping/billing addresses (`city_id` was dropped 2026-07-24; city is a plain name) |
| `ws_customer_shipping` | 4 | Per-order shipping snapshot |
| `ws_customer_bank_account` | 1 | Payout bank details for referral withdrawals |
| `ws_customer_education` | 10 | Education-level master for the profile picker |
| `ws_customer_state` | 14 | State master |
| `ws_customer_distict` | 34 | District master (legacy misspelling preserved) |
| `ws_customer_target_goal` | 21 | Goal master + `labels` JSON; drives goal-based catalog filtering |

### Admin, roles & RBAC
| Table | Rows | Built for |
|---|---|---|
| `ws_users` | 5 | Admin/staff accounts |
| `ws_admin_access_tokens` | 35 | Admin token records for revocation |
| `ws_roles` | 32 | Role definitions |
| `ws_permissions` | 1942 | Permission catalog, seeded at boot |
| `ws_permission_category` | 25 | Grouping for the permission catalog UI |
| `ws_role_has_permissions` | 9 | Role → permission grants |
| `ws_model_has_roles` | 33 | Subject → role assignment |
| `ws_model_has_permissions` | 0 | Direct subject → permission grants (bypassing roles) |
| `ws_activity_log` | 0 | Admin audit trail |

### Catalog — courses, packages, video
| Table | Rows | Built for |
|---|---|---|
| `ws_course` | 2 | Course entity |
| `ws_course_educator` | 56 | Course ↔ educator pivot |
| `ws_course_subject_category` | 1 | Course → subject/category mapping |
| `ws_course_book` | 0 | Physical books bundled with a course |
| `ws_package` | 7 | Package entity; `is_individual` splits label-based vs goal-level |
| `ws_package_type` | 4 | Package type master |
| `ws_package_category` | 3 | Package category master |
| `ws_package_specific_subject` | 1628 | Subject scoping per package |
| `ws_package_course_material` | 1 | Material attached to a package/course |
| `ws_package_chat` | 0 | Per-package discussion/chat |
| `ws_video` | 157 | Lecture video records (VideoCrypt/StreamOS ids) |
| `ws_video_category` | 168 | Video folder/category tree nodes |
| `ws_video_category_relation` | 2490 | Parent↔child DAG — **authoritative source** for video hierarchy reads |
| `ws_video_category_package_relation` | 5174 | Which video categories a package exposes |
| `ws_folder` / `ws_folder_item` | 6 / 2 | Generic content folders and their members |

### Study material & ebooks
| Table | Rows | Built for |
|---|---|---|
| `ws_material` | 227 | Downloadable study material |
| `ws_material_category` | 5 | Material category tree (parent column only, no relation table) |
| `ws_material_category_course` | 8 | Material category ↔ course |
| `ws_material_category_package` | 16 | Material category ↔ package |
| `ws_ebook` | 507 | Ebook entity + upload columns |
| `ws_ebook_download` | 2 | Per-customer download grants/counters |
| `ws_pdf_upload_job` | 6 | BullMQ single-PDF→ebook pipeline job state (Socket.io progress) |
| `ws_current_affair` | 0 | Current-affairs content feed |

### Exams & test series
| Table | Rows | Built for |
|---|---|---|
| `ws_exam` | 4 | Quiz/exam definition |
| `ws_exam_question` | 3 | Questions |
| `ws_exam_question_option` | 12 | Answer options |
| `ws_exam_category` | 122 | Exam category tree (`parent_id`) |
| `ws_exam_category_pivot` | 5 | **Chosen leaf categories** per quiz (re-purposed from ancestor rollup) |
| `ws_exam_category_course` | 6 | Exam category ↔ course |
| `ws_exam_category_package` | 69 | Exam category ↔ package |
| `ws_exam_result` | 3 | Attempt header (lifecycle: start/resume/submit) |
| `ws_exam_result_detail` | 3 | Per-question answers |
| `ws_exam_result_detail_analytics` | 1 | Derived attempt analytics |
| `ws_exam_countdown` | 2 | Exam countdown widget entries |
| `ws_exam_countdown_category` | 1 | Countdown ↔ category mapping |
| `ws_test_series` | 1 | Test series entity |
| `ws_test_series_exam` | 1 | Series ↔ exam membership |
| `ws_test_series_content_category` | 1 | Series content grouping |
| `ws_test_series_price` | 1 | Series pricing plans |
| `ws_test_series_order` | 4 | Series purchase orders |
| `ws_test_series_subscription` | 2 | Active series entitlements |

### Live classes
| Table | Rows | Built for |
|---|---|---|
| `ws_live_course` | 4 | Live course entity |
| `ws_live_course_plan` | 4 | Live course pricing plans |
| `ws_live_course_subscription` | 13 | Live course entitlements (+ promoter_id/%/paid_amount) |
| `ws_live_session` | 14 | Scheduled sessions; `notified_stream_id` is the go-live notify claim |
| `ws_live_session_course` | 15 | Session ↔ live course, holds `folder_id` |
| `ws_live_session_attendance` | 88 | Per-viewer attendance |
| `ws_live_session_reminder` | 1 | Client-set reminders |
| `ws_live_session_preview` | 4 | Free preview windows |
| `ws_live_chat_message` | 11 | In-session chat persistence |
| `ws_live_chat_setting` | 9 | Per-session chat config |
| `ws_live_chat_ban` | 0 | Chat bans |
| `ws_live_poll` / `_option` / `_vote` | 1 / 2 / 2 | In-session polls |
| `ws_live_banner_slider` | 1 | Banner slider on the live surface |

### Commerce — orders, pricing, subscriptions
| Table | Rows | Built for |
|---|---|---|
| `ws_package_course_ebook_price` | 1360 | **Unified pricing-plan table** for package/course/ebook (`duration` in DAYS) |
| `ws_package_course_order` | 28 | Orders for package/course/ebook |
| `ws_package_course_subscription` | 600015 | **The entitlement table** — largest table in the DB |
| `ws_package_course_subscription_tracking` | 12 | Subscription lifecycle/tracking events |
| `ws_ebook_order` | 13 | Ebook-specific orders |
| `ws_ebook_subscription` | 10 | Ebook entitlements |
| `ws_promocode` | 3 | Single consolidated promocode table (`ws_promo_code` was merged in and dropped) |
| `ws_promoted_package_course_ebook` | 6 | Promoter plan links (`plan_kind` + planId) |
| `ws_enrollment_resume` | 8 | Per `customer+scope_kind+scope_id` resume pointer (Layer-2 over lecture progress) |
| `ws_export_job` | 9 | Async report-export jobs (BullMQ → Spaces → signed URL) |

### Books (physical)
| Table | Rows | Built for |
|---|---|---|
| `ws_book` | 14 | Physical book catalog |
| `ws_book_cart` / `ws_book_cart_item` | 10 / 16 | Book cart |
| `ws_book_order` / `ws_book_order_item` | 12 / 13 | Book orders |
| `ws_book_tracking` | 9 | Courier tracking (Tirupati AWB / Mahavir link) |
| `ws_book_setting` | 1 | Shipping/book config |

### Referral & promoter
| Table | Rows | Built for |
|---|---|---|
| `ws_promoter` | 114 | Promoter accounts |
| `ws_promoter_access_tokens` | 0 | Promoter token records |
| `ws_refferal_program` | 1 | Referral program config |
| `ws_refferal_transaction` | 7 | Referral credit ledger |
| `ws_refferal_term` | 0 | Referral T&C content |
| `ws_refferal_faq` | 0 | Referral FAQ content |

### Learning progress
| Table | Rows | Built for |
|---|---|---|
| `ws_lecture_progress` | 12 | Watch progress — actually **global per (customer, video)**, not per container |
| `ws_lecture_note` | 3 | Text notes on a lecture |
| `ws_lecture_audio_note` | 4 | Audio notes on a lecture |
| `ws_wishlist` | 0 | Client wishlist |
| `ws_search_history` | 4 | Per-customer search history |

### Offline centres
| Table | Rows | Built for |
|---|---|---|
| `ws_offline_center` | 2 | Physical centre master (keeps its own `city_id`) |
| `ws_offline_city` | 2 | Offline city master |
| `ws_offline_batch` | 2 | Batches at a centre |
| `ws_offline_enquiry` | 2 | Walk-in/offline enquiries |
| `ws_offline_banner_slider` | 4 | Banner slider on the offline surface |

### CMS, notifications & app config
| Table | Rows | Built for |
|---|---|---|
| `ws_notification` | 71 | Push/in-app notification records |
| `ws_notification_dismissal` | 134 | Per-customer dismissal state |
| `ws_popup_notification` | 36 | Popup/interstitial campaigns |
| `ws_image_notification` | 1 | Image-based notification campaigns |
| `ws_banner_slider` | 2 | Home banner slider |
| `ws_testimonial` | 5 | Testimonials |
| `ws_faq` | 13 | General FAQ (accessor is `prisma.fAQ`) |
| `ws_termsandcondition` | 3 | T&C content |
| `ws_department` / `ws_department_contact` | 4 / 13 | Contact-us departments and their contacts |
| `ws_website_inquiry` | 3 | Website contact-form submissions |
| `ws_social_link` / `ws_social_link_type` | 0 / 0 | Social links footer/CMS |
| `ws_app_update` | 1 | Force/soft app-update gate |
| `ws_versions` | 1 | App version records |
| `ws_dynamic_image` | 1 | **Unused** legacy site-logo holder |

---

## 3. Recommended actions

1. **Fix first:** create `ws_educator_access_tokens` (or find the missing DDL) — educator
   auth is broken locally.
2. **Safe to drop** (legacy Laravel, zero rows, zero refs, no model):
   `ws_failed_jobs`, `ws_password_resets`, `ws_personal_access_tokens`, `ws_tag`.
3. **Drop after confirming nothing external reads it:** `ws_migrations` (10 rows of
   Laravel history), `ws_dynamic_image` (+ remove the `DynamicImage` model).
4. **Investigate, don't drop:** `ws_social_link` / `ws_social_link_type` and
   `ws_package_chat` — code exists but they have never held a row.
5. **Keep:** `_ddl_migrations`, `_ist_backfill` — our own tooling ledgers.
