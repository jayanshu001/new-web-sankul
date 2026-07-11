/**
 * Commerce · eBook Subscription (READ) service — dual-path (MySQL/Prisma ↔ Mongo).
 *
 * Module key: `commerce-ebook-sub` (Phase 3a, READ-ONLY). Table:
 * `ws_ebook_subscription` (1 row) — the **ebook entitlement source of truth**.
 * Exposes the access-gate + listing reads that mirror the Mongo consumer
 * predicates 1:1. WRITES (create on payment) are Phase 3b — NOT here.
 *
 * Built dual-path but kept flag OFF: rows are joined on the int catalog (ebook)
 * + int customer id-space and read by still-Mongo consumers (ebook read/list,
 * downloads, dashboard). Flips together with catalog + the rest of 3a in one
 * consistent int id-space. Verify via live-DB tsx, not HTTP, while OFF.
 *
 * C3 seam: `customerId` is an INT here (SQL `customer_id` is int) — same as the
 * package subscription module.
 */
import { commerceEbookSubRepository as repo } from "./commerce-ebook-sub.repository";
import { catalogEbookRepository } from "../catalog-ebook/catalog-ebook.repository";
import { toEbookSubscriptionDto } from "./commerce-ebook-sub.transformer";
import { toEbookDto } from "../catalog-ebook/catalog-ebook.transformer";
import type { EbookSubscriptionDto } from "./commerce-ebook-sub.types";

/** Whole-day difference (ceil), matching the controller's `daysBetween`. */
const daysBetween = (from: Date, to: Date): number =>
  Math.max(0, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));

export const EBOOK_SUB_MODULE = "commerce-ebook-sub";

/** Whether the ebook-subscription read-path is served from MySQL. */
export const isEbookSubMysql = (): boolean => true;

/** Parse a string id to a positive int, else null. */
export const parseEbookSubId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// ── entitlement check (the access gate) ─────────────────────────────────────

/**
 * Does this customer hold an ACTIVE, unexpired ebook entitlement?
 * Mirrors `findOne({customerId, ebookId, status:true, endAt:{$gt:now}})`.
 */
export const hasActiveEbookSubscription = async (
  customerId: number,
  ebookId: number,
  now: Date = new Date()
): Promise<boolean> => {
  const row = await repo.findActiveSub(customerId, ebookId, now);
  return row !== null;
};

/** The active ebook entitlement row (e.g. for its endAt), or null. */
export const getActiveEbookSubscription = async (
  customerId: number,
  ebookId: number,
  now: Date = new Date()
): Promise<EbookSubscriptionDto | null> => {
  const row = await repo.findActiveSub(customerId, ebookId, now);
  return row ? toEbookSubscriptionDto(row) : null;
};

// ── single / listings ───────────────────────────────────────────────────────

export const findEbookSubscriptionById = async (
  id: number
): Promise<EbookSubscriptionDto | null> => {
  const row = await repo.findById(id);
  return row ? toEbookSubscriptionDto(row) : null;
};

export const findEbookSubscriptionByOrderId = async (
  orderId: number
): Promise<EbookSubscriptionDto | null> => {
  const row = await repo.findByOrderId(orderId);
  return row ? toEbookSubscriptionDto(row) : null;
};

/** All ebook subscriptions for a customer, newest first. */
export const listEbookSubscriptionsByCustomer = async (
  customerId: number
): Promise<EbookSubscriptionDto[]> => {
  const rows = await repo.listByCustomer(customerId);
  return rows.map(toEbookSubscriptionDto);
};

/** Active ebook subscriptions for a customer (the "downloads" surface). */
export const listActiveEbookSubscriptionsByCustomer = async (
  customerId: number,
  now: Date = new Date()
): Promise<EbookSubscriptionDto[]> => {
  const rows = await repo.listActiveByCustomer(customerId, now);
  return rows.map(toEbookSubscriptionDto);
};

/**
 * Active, unexpired ebook subs for a customer scoped to a set of ebook ids —
 * for computing per-ebook access windows in the listing. Returns minimal rows
 * `{ebookId, endAt}` (ids as numbers). Empty input short-circuits to `[]`.
 */
export const listActiveByCustomerForEbooks = async (
  customerId: number,
  ebookIds: number[],
  now: Date = new Date()
): Promise<Array<{ ebookId: number | null; endAt: Date | null }>> => {
  if (!ebookIds.length) return [];
  return repo.listActiveByCustomerForEbooks(customerId, ebookIds, now);
};

/**
 * The "my subscriptions" listing: a customer's ACTIVE ebook subscriptions
 * (endAt soonest-first), each spread into its ebook DTO + the subscription's
 * access window. Mirrors the Mongo handler output:
 *   `{ ...ebook, startAt, endAt, daysLeft, shareableLink }`.
 *
 * `search` scopes by ebook name/author (resolved to matching ebook ids first,
 * since the searchable text lives on the ebook, not the subscription row).
 * `buildShareLink(ebookId)` supplies the per-request deep link (HTTP concern).
 */
export const listMyEbookSubscriptions = async (
  customerId: number,
  opts: { search?: string; skip: number; take: number },
  buildShareLink: (ebookId: string) => string = (id) => id,
  now: Date = new Date()
): Promise<{ subscriptions: any[]; total: number }> => {
  // Search scoping: resolve matching ebook ids up front; empty match → no rows.
  let ebookIds: number[] | undefined;
  if (opts.search) {
    const matched = await catalogEbookRepository.listActive({ search: opts.search });
    ebookIds = matched.map((e) => e.id);
    if (ebookIds.length === 0) return { subscriptions: [], total: 0 };
  }

  const [rows, total] = await Promise.all([
    repo.listActiveWithEbookByCustomer(customerId, { ebookIds, skip: opts.skip, take: opts.take }, now),
    repo.countActiveWithEbookByCustomer(customerId, { ebookIds }, now),
  ]);

  const subscriptions = rows
    .filter((s) => s.eBook)
    .map((s) => {
      // Active subscription ⇒ entitled → issue the book media token.
      const dto = toEbookDto(s.eBook!, { customerId, entitled: true });
      return {
        ...dto,
        startAt: s.startAt ?? null,
        endAt: s.endAt ?? null,
        daysLeft: s.endAt ? daysBetween(now, s.endAt) : 0,
        shareableLink: buildShareLink(dto._id),
      };
    });

  return { subscriptions, total };
};

// ── active-owner count ───────────────────────────────────────────────────────

/** Count active owners of an ebook. */
export const countActiveByEbook = async (
  ebookId: number,
  now: Date = new Date()
): Promise<number> => repo.countActiveByEbook(ebookId, now);
