/**
 * Customer shipping: address → shipping snapshot.
 *
 * `ws_customer_address` is the address book the customer picks from;
 * `ws_customer_shipping` is the dispatch address every order table's shipping
 * column references (package/course order + subscription `shipping`, book order
 * `shipping_id`, book cart). An address id must never be stored in those
 * columns. Every order path resolves through here so none can drift back.
 *
 * Snapshot rule: find-or-create on (owner, name, phone, address, pincode), so one
 * shipping row is shared by every order to the same address. Consequence:
 * `refreshOnReuse` rewrites the shared row's email/city/state/address_2 in place,
 * which also changes already-placed orders' receipts and AWBs. If order history
 * must be immutable, always create instead (see docs/MIGRATION_QUERY_CHANGES.md).
 */
import { customerShippingRepository as repo } from "./customer-shipping.repository";

export type ResolveShippingFailure = "address_not_found" | "phone_missing" | "city_missing" | "snapshot_missing";

export type ResolveShippingResult =
  | { ok: true; shippingId: number; city: string; phone: bigint }
  | { ok: false; reason: ResolveShippingFailure };

/**
 * Also the ownership gate: `address_not_found` means the id is unknown,
 * soft-deleted, or someone else's; callers must reject the checkout.
 *
 * @param opts.refreshOnReuse update a matching snapshot's mutable fields from the address.
 * @param opts.includeSoftDeleted backfill only; a checkout must never reach one.
 * @param opts.createIfMissing false makes the call read-only (reports
 *        `snapshot_missing`), so the backfill dry run cannot write.
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
    // ws_customer_shipping.city is VARCHAR(20), narrower than the address column;
    // truncate rather than fail mid-checkout.
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
