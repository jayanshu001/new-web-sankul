/**
 * Transforms ws_* subscription/order rows (+ hydrated reference rows) into the
 * exact DTO shape the legacy Mongo customer-details handler returned, so the
 * admin UI is identical on either backend. Refs are emitted as `{ _id, name, … }`
 * populated sub-objects; Decimals become numbers; `isActive` = status && endAt>now.
 */

type Lookup<T> = Map<number, T>;

const dec = (v: unknown): number | null => (v == null ? null : Number(v));
const isActiveOf = (status: boolean | null | undefined, endAt: Date | null | undefined, now: Date) =>
  !!(status && endAt && endAt > now);

const ref = (
  id: number | null | undefined,
  fields: Record<string, unknown> | null | undefined
) => (id == null || !fields ? null : { _id: String(id), ...fields });

// Plan price row → Mongo `packageId`/`planId` populated shape ({ name, duration, price }).
const planRef = (
  id: number | null | undefined,
  plan: { name: string | null; duration: number; price: unknown } | undefined
) => (id == null || !plan ? null : { _id: String(id), name: plan.name ?? null, duration: plan.duration, price: dec(plan.price) });

// ── Package/course subscription (one model, split by course vs package) ────────
type PkgSub = {
  id: number; courseId: number | null; packageId: number | null; planId: number | null;
  // `amount` is the canonical paid value on ws_package_course_subscription (written by
  // the create path, summed by the Subscription Report). `paid_amount` is a later
  // promoter-only column (2026-06-19_subscription_promoter_cols.sql) that stays NULL
  // for non-promoter subs — so paidAmount is sourced from `amount`, not `paid_amount`.
  amount: unknown; status: boolean | null; startAt: Date | null; endAt: Date | null;
};

export const toCourseDto = (
  s: PkgSub,
  courses: Lookup<{ name: string | null; image: string | null; level: string | null }>,
  plans: Lookup<{ name: string | null; duration: number; price: unknown }>,
  now: Date
) => {
  const course = s.courseId != null ? courses.get(s.courseId) : undefined;
  return {
    _id: String(s.id),
    courseId: ref(s.courseId, course && { name: course.name, image: course.image, level: course.level }),
    packageId: planRef(s.planId, s.planId != null ? plans.get(s.planId) : undefined),
    paidAmount: dec(s.amount),
    paymentStatus: s.status ? "verified" : "pending",
    startAt: s.startAt,
    endAt: s.endAt,
    isActive: isActiveOf(s.status, s.endAt, now),
  };
};

export const toPackageDto = (
  s: PkgSub,
  packages: Lookup<{ name: string | null; image: string | null }>,
  plans: Lookup<{ name: string | null; duration: number; price: unknown }>,
  now: Date
) => {
  const pkg = s.packageId != null ? packages.get(s.packageId) : undefined;
  return {
    _id: String(s.id),
    targetPackageId: ref(s.packageId, pkg && { name: pkg.name, image: pkg.image }),
    packageId: planRef(s.planId, s.planId != null ? plans.get(s.planId) : undefined),
    paidAmount: dec(s.amount),
    paymentStatus: s.status ? "verified" : "pending",
    startAt: s.startAt,
    endAt: s.endAt,
    isActive: isActiveOf(s.status, s.endAt, now),
  };
};

// ── Live course subscription ───────────────────────────────────────────────────
type LiveSub = {
  id: number; liveCourseId: number; planId: number | null; paidAmount: number | null;
  discountAmount: number | null; paymentStatus: string | null; status: boolean | null;
  startAt: Date | null; endAt: Date | null;
};

export const toLiveCourseDto = (
  s: LiveSub,
  liveCourses: Lookup<{ name: string | null; image: string | null; level: string | null }>,
  plans: Lookup<{ name: string | null; duration: number; price: unknown }>,
  now: Date
) => {
  const live = liveCourses.get(s.liveCourseId);
  return {
    _id: String(s.id),
    liveCourseId: ref(s.liveCourseId, live && { name: live.name, image: live.image, level: live.level }),
    planId: planRef(s.planId, s.planId != null ? plans.get(s.planId) : undefined),
    paidAmount: s.paidAmount ?? null,
    discountAmount: s.discountAmount ?? null,
    paymentStatus: s.paymentStatus ?? (s.status ? "verified" : "pending"),
    startAt: s.startAt,
    endAt: s.endAt,
    isActive: isActiveOf(s.status, s.endAt, now),
  };
};

// ── Test series subscription ───────────────────────────────────────────────────
type TestSub = {
  id: number; testSeriesId: number; planId: number | null; price: unknown;
  status: boolean | null; startAt: Date | null; endAt: Date | null;
};

export const toTestSeriesDto = (
  s: TestSub,
  testSeries: Lookup<{ title: string; thumbnail: string | null }>,
  prices: Lookup<{ name: string | null; durationDays: number; price: unknown }>,
  now: Date
) => {
  const ts = testSeries.get(s.testSeriesId);
  const price = s.planId != null ? prices.get(s.planId) : undefined;
  return {
    _id: String(s.id),
    testSeriesId: ref(s.testSeriesId, ts && { name: ts.title, image: ts.thumbnail }),
    planId: price ? { _id: String(s.planId), name: price.name ?? null, duration: price.durationDays, price: dec(price.price) } : null,
    price: dec(s.price),
    startAt: s.startAt,
    endAt: s.endAt,
    isActive: isActiveOf(s.status, s.endAt, now),
  };
};

// ── Ebook subscription ─────────────────────────────────────────────────────────
type EbookSub = {
  id: number; ebookId: number | null; orderId: number | null; price: unknown;
  status: boolean | null; startAt: Date | null; endAt: Date | null;
};

export const toEbookDto = (
  s: EbookSub,
  ebooks: Lookup<{ name: string; author: string | null; publisher: string | null }>,
  orders: Lookup<{ paymentMethod: string; orderPrice: number; status: string; createdAt: Date | null }>,
  now: Date
) => {
  const eb = s.ebookId != null ? ebooks.get(s.ebookId) : undefined;
  const order = s.orderId != null ? orders.get(s.orderId) : undefined;
  return {
    _id: String(s.id),
    ebookId: ref(s.ebookId, eb && { name: eb.name, author: eb.author, publisher: eb.publisher }),
    orderId: order ? { _id: String(s.orderId), paymentMethod: order.paymentMethod, orderPrice: order.orderPrice, status: order.status, createdAt: order.createdAt } : null,
    price: dec(s.price),
    startAt: s.startAt,
    endAt: s.endAt,
    isActive: isActiveOf(s.status, s.endAt, now),
  };
};

// ── Physical book order ────────────────────────────────────────────────────────
type BookOrderRow = {
  id: number; receiptId: string; amount: unknown; paymentMethod: string;
  status: string; paidAt: Date | null; createdAt: Date | null;
};
type BookItemRow = { order_id: string; bookId: number | null; qty: number };

export const toPhysicalBookDto = (
  o: BookOrderRow,
  itemsByReceipt: Map<string, BookItemRow[]>,
  books: Lookup<{ name: string; image: string | null }>
) => {
  const items = (itemsByReceipt.get(o.receiptId) ?? []).map((it) => {
    const book = it.bookId != null ? books.get(it.bookId) : undefined;
    return {
      name: book?.name ?? null,
      qty: it.qty,
      bookId: ref(it.bookId, book && { name: book.name, image: book.image }),
    };
  });
  return {
    _id: String(o.id),
    items,
    amount: dec(o.amount),
    paymentMethod: o.paymentMethod,
    status: o.status,
    paidAt: o.paidAt,
    createdAt: o.createdAt,
  };
};

// ── Address ────────────────────────────────────────────────────────────────────
type AddressRow = {
  id: number; name: string; phone: bigint; alternate_phone: bigint | null;
  email: string; address: string; address_2: string; city: string;
  state: number | null; cityId: number | null; pincode: number;
  label: string | null; isDefault: boolean | null; created_at: Date | null;
};

export const toAddressDto = (
  a: AddressRow,
  states: Lookup<{ name: string; state_code: string }>
) => {
  const st = a.state != null ? states.get(a.state) : undefined;
  return {
    _id: String(a.id),
    // Editable fields (admin edit modal prefill). Phones are BIGINT → strings.
    name: a.name,
    phone: a.phone != null ? String(a.phone) : null,
    alternatePhone: a.alternate_phone != null ? String(a.alternate_phone) : null,
    email: a.email ?? null,
    line1: a.address,
    line2: a.address_2,
    city: a.city,
    cityId: a.cityId != null ? String(a.cityId) : null,
    stateId: ref(a.state, st && { name: st.name, stateCode: st.state_code }),
    pincode: a.pincode,
    label: a.label ?? null,
    isDefault: a.isDefault ?? false,
    createdAt: a.created_at,
  };
};
