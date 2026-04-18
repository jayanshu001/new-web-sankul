# Web Sankul — Entity Relationship Diagram

Derived from the Mongoose schemas in `src/models/**/*.model.ts`. Although the
backend is MongoDB (document model), the relationships are fully normalised
via `Schema.Types.ObjectId` + `ref` pointers, so an ER view is accurate.

**Notation (Mermaid crow's-foot):**

- `||--o{` one-to-many · `||--||` one-to-one · `}o--o{` many-to-many
- `}o--o|` many-to-zero-or-one (optional FK)
- **embedded array** means the child lives inside the parent document (no
  separate collection); still shown as a relationship for clarity.

Diagrams are split by bounded context to stay readable. Cross-context edges
(e.g. `Customer` → `Subscription`) are declared once in the context that owns
the child entity.

---

## 1. Customer & Authentication

```mermaid
erDiagram
    Customer ||--o{ CustomerAccessToken : "issues"
    Customer ||--o{ CustomerOtp : "receives"
    Customer ||--o{ CustomerBankAccount : "owns"
    Customer }o--o| CustomerState : "located in"
    Customer }o--o| CustomerDistrict : "located in"
    Customer }o--o| CustomerEducation : "has"
    Customer }o--o{ CustomerTargetGoal : "selects (array:goals)"
    CustomerDistrict }o--|| CustomerState : "belongs to"

    Customer {
        ObjectId _id PK
        string   phoneNumber UK "unique,  maxLen 11"
        string   emailAddress
        string   firstName
        string   middleName
        string   lastName
        string   password "select:false"
        boolean  isPhoneVerified
        string   otp "select:false"
        date     otpExpiresAt
        number   triedOtp
        date     otpBlockedAt
        string   profilePicture
        string   phone2
        date     dob
        string   gender
        ObjectId stateId FK
        ObjectId districtId FK
        ObjectId educationId FK
        string   city
        string   language
        ObjectId goals "FK[] -> CustomerTargetGoal"
        string   referralCode
        number   rewardPoints
        boolean  verified
        boolean  status
        boolean  isAccountDeleted
        date     createdAt
        date     updatedAt
    }

    CustomerAccessToken {
        ObjectId _id PK
        ObjectId customerId FK
        string   token
        string   refreshToken
        boolean  active
        boolean  deleted
        date     expiresAt
    }

    CustomerOtp {
        ObjectId _id PK
        ObjectId customerId FK
        string   otp
        date     createdAt
    }

    CustomerBankAccount {
        ObjectId _id PK
        ObjectId customerId FK
        string   accountHolderName
        string   accountNumber
        string   ifscCode
    }

    CustomerState {
        ObjectId _id PK
        string   name
        string   stateCode
        boolean  active
    }

    CustomerDistrict {
        ObjectId _id PK
        string   name
        ObjectId stateId FK
        boolean  active
    }

    CustomerEducation {
        ObjectId _id PK
        string   name
        boolean  status
    }

    CustomerTargetGoal {
        ObjectId _id PK
        string   name
        string   image
        boolean  active
    }
```

### Goal (admin-managed goal catalog with embedded labels)

`Goal` is a separate entity from `CustomerTargetGoal`. It models the admin-side
*goal catalog* (e.g. "Career Growth") with an embedded array of labels
(e.g. "Interview Prep", "Resume Building"). The Customer's `goals[]` array
actually points at **label `_id`s nested inside Goal documents**, not at the
Goal itself — that's why the profile service uses an aggregation unwind.

```mermaid
erDiagram
    Goal ||--o{ GoalLabel : "embeds labels[]"

    Goal {
        ObjectId _id PK
        string   title
        string   image
        boolean  isActive
        date     createdAt
        date     updatedAt
    }

    GoalLabel {
        ObjectId _id PK "embedded subdoc"
        string   name
    }
```

---

## 2. Admin / RBAC

```mermaid
erDiagram
    AdminUser }o--o{ Role : "has (array:roles)"
    AdminUser }o--o{ Permission : "has (array:permissions)"
    AdminUser ||--o{ AdminAccessToken : "issues"

    AdminUser {
        ObjectId _id PK
        string   firstName
        string   lastName
        string   email UK
        string   password "select:false"
        string   image
        string   role "enum: super_admin, admin, editor"
        boolean  status
        boolean  isDark
        date     emailVerifiedAt
        string   rememberToken "select:false"
        date     lastLoginDate
        string   lastLoginIp
        date     lastSeenAt
        ObjectId roles "FK[] -> Role"
        ObjectId permissions "FK[] -> Permission"
        date     createdAt
        date     updatedAt
    }

    Role {
        ObjectId _id PK
        string   name
        string   guardName
    }

    Permission {
        ObjectId _id PK
        string   name
        string   guardName
    }

    AdminAccessToken {
        ObjectId _id PK
        ObjectId adminUserId FK
        string   token
        string   refreshToken
        boolean  active
        boolean  deleted
        date     expiresAt
    }
```

> **Note:** `role` (enum string) and `roles[]` (ref array) coexist. The string
> is the primary ACL input checked by `requireRole(...)` middleware; the
> `roles[]`/`permissions[]` arrays are scaffolded for future fine-grained RBAC
> but not yet consumed by a route handler.

---

## 3. Course Catalog & Video Hierarchy

The heart of the Course Management module. Key relationships:

- **Course** owns references to the four master tables (educator, subject,
  video-category, material).
- **VideoCategory** is self-referential via the join-collection
  `VideoCategoryRelation(parent, child)` (a true tree, unique on `(parent,
  child)`).
- **MaterialCategory** and **ExamCategory** are self-referential via a plain
  `parent: ObjectId | null` column (simple adjacency list tree).
- **Course ↔ MaterialCategory** and **Course ↔ ExamCategory** are modelled as
  **embedded arrays** on the Course document (not separate join collections) —
  this replaces SQL-style `MaterialCategoryCourse` / `ExamCategoryCourse` join
  tables from websankul-api-staging.
- **Video** (lecture) belongs to one `VideoCategory`.

```mermaid
erDiagram
    Course }o--o| CourseEducator : "taught by"
    Course }o--o| CourseSubjectCategory : "categorised under"
    Course }o--o| VideoCategory : "uses as root folder"
    Course }o--o| PackageCourseMaterial : "ships material"
    Course }o--o{ MaterialCategory : "embeds materialCategories[]"
    Course }o--o{ ExamCategory : "embeds examCategories[]"

    CourseSubjectCategory ||--o{ CourseSubjectCategory : "parent → children"
    MaterialCategory      ||--o{ MaterialCategory      : "parent → children"
    ExamCategory          ||--o{ ExamCategory          : "parent → children"

    VideoCategory ||--o{ VideoCategoryRelation : "is parent of"
    VideoCategory ||--o{ VideoCategoryRelation : "is child of"
    VideoCategory ||--o{ Video : "contains lectures"
    VideoCategory }o--o| Course : "scoped to (auto-folder)"

    Course {
        ObjectId _id PK
        string   name
        string   description
        string   image
        number   ordered
        string   shareableLink
        string   withMaterial "display label"
        string   withoutMaterial "display label"
        string   level
        boolean  status
        ObjectId courseEducatorId FK
        ObjectId courseSubjectCategoryId FK
        ObjectId videoCategoryId FK
        ObjectId pcMaterialId FK
        array    materialCategories "[{category:FK, order:number}]"
        array    examCategories "[{category:FK, order:number}]"
        date     createdAt
        date     updatedAt
    }

    CourseEducator {
        ObjectId _id PK
        string   name
        string   image
        string   about
        string   email UK
        string   password "nullable"
        number   view
        boolean  status
    }

    CourseSubjectCategory {
        ObjectId _id PK
        string   title
        string   slug UK
        string   image
        mixed    parent "0 for root (staging parity)"
        number   order
        boolean  status
    }

    PackageCourseMaterial {
        ObjectId _id PK
        string   title
        string   image
        boolean  isActive
    }

    VideoCategory {
        ObjectId _id PK
        string   title
        string   slug
        string   image
        ObjectId courseId FK "nullable; set for auto-root folders"
        number   order_by
        boolean  status
    }

    VideoCategoryRelation {
        ObjectId _id PK
        ObjectId parent FK
        ObjectId child FK
        number   order
    }

    Video {
        ObjectId _id PK
        ObjectId videoCategoryId FK
        string   title
        string   platform "enum: youtube, aws, vimeo"
        string   youtube_id
        string   aws_id
        string   vimeo_id
        number   order
        boolean  status
    }

    MaterialCategory {
        ObjectId _id PK
        string   title
        string   image
        ObjectId parent FK "nullable (root if null)"
        number   order
        boolean  status
    }

    ExamCategory {
        ObjectId _id PK
        string   title
        string   image
        ObjectId parent FK "nullable (root if null)"
        number   order
        boolean  status
    }
```

---

## 4. Commerce: Plans · Promos · Subscriptions · Shipping

Separate context because it bridges **customer** and **course** — every arrow
here crosses a bounded-context boundary.

```mermaid
erDiagram
    Course ||--o{ PackageCourseEbookPrice : "has plans"
    PackageCourseEbookPrice ||--o{ PromotedPackageCourseEbook : "promoted via"
    PromoCode ||--o{ PromotedPackageCourseEbook : "applies to plans"

    Customer ||--o{ PackageCourseSubscription : "subscribes to"
    Course   ||--o{ PackageCourseSubscription : "has subscribers"
    PackageCourseEbookPrice ||--o{ PackageCourseSubscription : "chosen plan"
    PackageCourseSubscription }o--o| CustomerShipping : "ships to"

    Customer ||--o{ CustomerShipping : "has shipping records"
    Customer ||--o{ CustomerAddress : "has addresses"
    CustomerShipping }o--o| CustomerState : "located in"
    CustomerAddress  }o--o| CustomerState : "located in"

    PackageCourseEbookPrice {
        ObjectId _id PK
        ObjectId courseId FK
        string   name
        number   duration "months"
        number   price
        boolean  withMaterial
        number   materialPrice
        boolean  isDefault
        boolean  status
    }

    PromoCode {
        ObjectId _id PK
        string   type "enum: public, private"
        string   promocode
        string   title
        string   description
        date     promo_start_at
        date     promo_expire_at
        boolean  status
    }

    PromotedPackageCourseEbook {
        ObjectId _id PK
        ObjectId planId FK
        ObjectId promocodeId FK
    }

    PackageCourseSubscription {
        ObjectId _id PK
        ObjectId customerId FK
        ObjectId courseId FK
        ObjectId packageId FK
        ObjectId customerShippingId FK "nullable"
        number   trackingId "courier doc number, nullable"
        boolean  status
        date     createdAt
        date     updatedAt
    }

    CustomerShipping {
        ObjectId _id PK
        ObjectId customerId FK
        string   name
        string   phone
        string   alternatePhone
        string   email
        string   address
        string   address2
        string   city
        ObjectId stateId FK
        string   pincode
        boolean  status
    }

    CustomerAddress {
        ObjectId _id PK
        ObjectId customerId FK
        string   name
        string   phone
        string   alternatePhone
        string   email
        string   address
        string   address2
        string   city
        ObjectId stateId FK
        string   pincode
        boolean  status
    }
```

---

## 5. System / Content (no inter-entity relationships)

These are flat global-config or CMS-style entities. They're listed here for
completeness but have no foreign keys to other domains.

| Entity | Purpose |
|---|---|
| `AppUpdate` | Force-update manifest for mobile clients |
| `BannerSlider` | Home-page banners |
| `Department` | Internal admin grouping |
| `DynamicImage` | Keyed image slots for theming |
| `FAQ` | Public FAQ entries |
| `ImageNotification` | Image-based in-app notifications |
| `PopupNotification` | Interstitial popups |
| `TermsAndConditions` | Legal text |
| `Testimonial` | Homepage testimonials |
| `Version` | API/client version gating |

---

## Flow highlights (how the ER supports the 4 client routes)

| Route | Collections touched |
|---|---|
| `GET /api/v1/client/courses/:id` | `Course` → populate `CourseEducator`, `CourseSubjectCategory`, `MaterialCategory[]`, `ExamCategory[]` · `Video.find({videoCategoryId})` · `PackageCourseEbookPrice.find({courseId})` · `PromotedPackageCourseEbook.find({planId ∈ plans})` → populate `PromoCode` filtered by `type:public` |
| `POST /api/v1/client/courses/shipping` | Upsert `CustomerAddress` + `CustomerShipping` keyed by (customerId + normalized fields); populate `CustomerState` |
| `GET /api/v1/client/courses/orders/:id` | `PackageCourseSubscription.findOne({_id, customerId})` populate `Course`, `PackageCourseEbookPrice`, `CustomerShipping` — branch tracking URL on `trackingId < TIRUPATI.INITIAL_Number` |
| `GET /api/v1/client/courses/orders/:id/invoice` | `PackageCourseSubscription` → `Course` + `PackageCourseEbookPrice` → pdfkit stream |

## Cascade map (admin-side delete semantics)

| Action | Cascaded writes |
|---|---|
| `DELETE /admin/courses/:id` | `PackageCourseEbookPrice.deleteMany({courseId})` · `VideoCategory.deleteMany({courseId})` · `VideoCategoryRelation.deleteMany` where parent or child matches a deleted folder |
| `DELETE /admin/courses/video-categories/:id` | `VideoCategoryRelation.deleteMany` where parent or child == this id |
| `DELETE /admin/master/video-categories/:id` | Same relation sweep as above |
| `DELETE /admin/master/video-categories/:id` when a `Course` still references it | Blocked with 409 |
| `DELETE /admin/courses/materials/:id` when referenced by `Course.pcMaterialId` | Blocked with 409 |

---

*Generated from `src/models/**/*.model.ts`. Regenerate by re-reading the
schemas — there's no autogen tool yet; the above is kept in sync manually.*
