/**
 * Address → shipping snapshot.
 *
 * `ws_customer_address` is the customer's ADDRESS BOOK — what they pick from at
 * checkout. `ws_customer_shipping` is the DISPATCH ADDRESS an order is actually
 * shipped to, and it is what every order table's shipping column is a foreign
 * key to:
 *
 *   ws_package_course_order.shipping            → ws_customer_shipping.id
 *   ws_package_course_subscription.shipping     → ws_customer_shipping.id
 *   ws_book_order.shipping_id / ws_book_cart    → ws_customer_shipping.id
 *
 * So an address id must NEVER be stored in those columns. The client and admin
 * UIs both hand us an address-book id (that is the only list they show), which
 * this resolver converts into a real shipping id by snapshotting the address.
 *
 * Extracted from `client-cart.service.attachShipping`, which has always done
 * this correctly for books, so that every order path shares ONE implementation
 * and cannot drift back into storing raw address ids.
 *
 * SNAPSHOT RULE — find-or-create on (owner, name, phone, address, pincode),
 * deliberately identical to the book-cart behaviour it replaces. One shipping
 * row is therefore SHARED by every order to the same address.
 * ⚠ Consequence: `refreshOnReuse` rewrites the shared row's email/city/state/
 * address_2 in place, so correcting those on an address book entry also changes
 * them on already-placed orders' receipts and AWBs. That is pre-existing book
 * behaviour, kept here for consistency. If order history must be immutable, the
 * change is to always create (never reuse) — see docs/MIGRATION_QUERY_CHANGES.md.
 */
import { customerShippingRepository as repo } from "./customer-shipping.repository";

export const CUSTOMER_SHIPPING_MODULE = "customer-shipping";

export type ResolveShippingFailure = "address_not_found" | "phone_missing" | "city_missing" | "snapshot_missing";

export type ResolveShippingResult =
  | { ok: true; shippingId: number; city: string; phone: bigint }
  | { ok: false; reason: ResolveShippingFailure };

/**
 * Resolve a customer's chosen ADDRESS-BOOK id into a `ws_customer_shipping.id`
 * safe to persist on an order.
 *
 * Also acts as the ownership gate: an `address_not_found` result means the id is
 * unknown, soft-deleted, or belongs to someone else — callers should reject the
 * checkout exactly as they did with the old `addressBelongsToCustomerSql` check.
 *
 * @param opts.refreshOnReuse when an existing snapshot matches, update its
 *        mutable fields from the address (book-cart behaviour). false leaves an
 *        existing row untouched.
 * @param opts.includeSoftDeleted accept an address the customer has since
 *        deleted. For the BACKFILL only — a checkout must never reach one.
 * @param opts.createIfMissing false makes the call strictly READ-ONLY: when no
 *        snapshot exists yet it reports `snapshot_missing` instead of creating
 *        one. Exists so the backfill's dry run cannot write.
 */
export const resolveShippingIdForAddress = async (
  customerId: number,
  addressId: number,
  opts: { refreshOnReuse?: boolean; includeSoftDeleted?: boolean; createIfMissing?: boolean } = {},
): Promise<ResolveShippingResult> => {
  const { refreshOnReuse = true, includeSoftDeleted = false, createIfMissing = true } = opts;
  const address = await repo.findAddress(addressId, customerId, includeSoftDeleted);
  if (!address) return { ok: false, reason: "address_not_found" };

  // Address carries phone (BigInt) + email; fall back to the customer profile.
  let phone = address.phone ?? BigInt(0);
  let email = address.email ?? "";
  if (!phone || !email) {
    const c = await repo.findCustomerContact(customerId);
    if (!phone && c?.phoneNumber) phone = BigInt(c.phoneNumber);
    email = email || c?.emailAddress || "";
  }
  if (!phone) return { ok: false, reason: "phone_missing" };

  // The address carries the city as a plain name string on the row itself.
  const cityName = (address.city ?? "").trim();
  if (!cityName) return { ok: false, reason: "city_missing" };

  const now = new Date();
  const shipData = {
    userId: customerId,
    name: address.name,
    phone,
    alternate_phone: address.alternate_phone ?? null,
    email,
    address: address.address,
    address_2: address.address_2 ?? "",
    // ws_customer_shipping.city is VARCHAR(20) — the address column is wider, so
    // truncate rather than let the insert fail mid-checkout.
    city: cityName.slice(0, 20),
    state: address.state ?? null,
    pincode: address.pincode,
    status: true,
    created_at: now,
    updated_at: now,
  };

  const existing = await repo.findShipping(customerId, address.name, phone, address.address, address.pincode);
  if (!existing && !createIfMissing) return { ok: false, reason: "snapshot_missing" };
  const shipping = existing
    ? refreshOnReuse
      ? await repo.updateShipping(existing.id, shipData)
      : existing
    : await repo.createShipping(shipData);

  return { ok: true, shippingId: shipping.id, city: cityName, phone };
};
