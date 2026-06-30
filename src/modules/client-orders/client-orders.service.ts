import { clientOrdersRepository as repo } from "./client-orders.repository";

export const CLIENT_ORDERS_MODULE = "client-orders";
export const isClientOrdersMysql = (): boolean => true;

export const parseOrdersCustomerId = (id: string | number): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const idStr = (v: number | null | undefined): string | null => (v != null && v > 0 ? String(v) : null);

const planDto = (p: any) =>
  p
    ? {
        _id: String(p.id),
        packageId: idStr(p.packageId),
        courseId: idStr(p.courseId),
        ebookId: idStr(p.ebookId),
        name: p.name ?? null,
        duration: p.duration,
        price: p.price,
        withMaterial: p.withMaterial,
        materialPrice: p.materialPrice ?? 0,
        isDefault: p.isDefault,
        status: p.status,
      }
    : null;

const parseItems = (raw: string | null): any => {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
};

/**
 * listMyOrders — all of a customer's course/package subscriptions, ebook
 * subscriptions, and book orders (newest-first), matching the Mongo controller's
 * `{ courseSubscriptions, ebookSubscriptions, bookOrders }` shape. ⚠ Mongo
 * populates `courseId`→{name,thumbnail} and `packageId`→the price doc; SQL maps
 * Course.image→thumbnail, resolves package_id directly, and hydrates the plan via
 * planId. Book order_items come from the JSON column.
 */
export const listMyOrders = async (customerId: number) => {
  const [courseRows, ebookRows, bookRows] = await Promise.all([
    repo.listCourseSubs(customerId),
    repo.listEbookSubs(customerId),
    repo.listBookOrders(customerId),
  ]);

  const courses = new Map((await repo.coursesByIds([...new Set(courseRows.map((r) => r.courseId).filter((x): x is number => x != null && x > 0))])).map((c) => [c.id, c]));
  const plans = new Map((await repo.plansByIds([...new Set(courseRows.map((r) => r.planId).filter((x): x is number => x != null && x > 0))])).map((p) => [p.id, p]));
  const ebooks = new Map((await repo.ebooksByIds([...new Set(ebookRows.map((r) => r.ebookId).filter((x): x is number => x != null && x > 0))])).map((e) => [e.id, e]));

  const courseSubscriptions = courseRows.map((r) => {
    const course = r.courseId ? courses.get(r.courseId) : null;
    const plan = r.planId ? plans.get(r.planId) : null;
    return {
      _id: String(r.id),
      courseId: course ? { _id: String(course.id), name: course.name, thumbnail: course.image ?? null } : null,
      packageId: planDto(plan), // Mongo populates packageId → the price/plan doc
      paidAmount: r.amount != null ? Number(r.amount) : 0,
      startAt: r.startAt ?? null,
      endAt: r.endAt ?? null,
      status: r.status,
      paymentMethod: r.payment_type ?? null,
      remark: r.remarks ?? null,
      withMaterial: r.pcMaterialId != null && r.pcMaterialId > 0,
      createdAt: r.createdAt ?? null,
      updatedAt: r.updatedAt ?? null,
    };
  });

  const ebookSubscriptions = ebookRows.map((r) => {
    const eb = r.ebookId ? ebooks.get(r.ebookId) : null;
    return {
      _id: String(r.id),
      ebookId: eb ? { _id: String(eb.id), name: eb.name, thumbnail: eb.thumbnail ?? null, author: eb.author ?? null } : idStr(r.ebookId),
      price: r.price != null ? Number(r.price) : 0,
      startAt: r.startAt ?? null,
      endAt: r.endAt ?? null,
      status: r.status,
      createdAt: r.createdAt ?? null,
      updatedAt: r.updatedAt ?? null,
    };
  });

  const bookOrders = bookRows.map((r) => ({
    _id: String(r.id),
    orderId: r.receiptId ?? null,
    gatewayOrderId: r.gatewayOrderId ?? null,
    items: parseItems(r.orderItems),
    amount: r.amount != null ? Number(r.amount) : 0,
    status: r.status,
    awb: r.trackingId != null ? String(r.trackingId) : null,
    createdAt: r.createdAt ?? null,
  }));

  return { courseSubscriptions, ebookSubscriptions, bookOrders };
};
