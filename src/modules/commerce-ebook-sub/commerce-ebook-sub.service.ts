// Ebook subscriptions: read-only access gate + listings over the entitlement table.
import { commerceEbookSubRepository as repo } from "./commerce-ebook-sub.repository";
import { computeDaysLeft } from "../../utils/planDuration";
import { catalogEbookRepository } from "../catalog-ebook/catalog-ebook.repository";

import { toEbookDto } from "../catalog-ebook/catalog-ebook.transformer";

const daysBetween = (from: Date, to: Date): number => computeDaysLeft(to, from) ?? 0;

export const hasActiveEbookSubscription = async (
  customerId: number,
  ebookId: number,
  now: Date = new Date()
): Promise<boolean> => {
  const row = await repo.findActiveSub(customerId, ebookId, now);
  return row !== null;
};

export const listActiveByCustomerForEbooks = async (
  customerId: number,
  ebookIds: number[],
  now: Date = new Date()
): Promise<Array<{ ebookId: number | null; endAt: Date | null }>> => {
  if (!ebookIds.length) return [];
  return repo.listActiveByCustomerForEbooks(customerId, ebookIds, now);
};

/**
 * "My subscriptions": active ebook subs (soonest-expiring first) as
 * `{ ...ebook, startAt, endAt, daysLeft, shareableLink }`. `search` matches ebook
 * name/author, so it resolves to ebook ids first.
 */
export const listMyEbookSubscriptions = async (
  customerId: number,
  opts: { search?: string; skip: number; take: number },
  buildShareLink: (ebookId: string) => string = (id) => id,
  now: Date = new Date()
): Promise<{ subscriptions: any[]; total: number }> => {
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
      // Active subscription means entitled, so the media token is issued.
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

export const countActiveByEbook = async (
  ebookId: number,
  now: Date = new Date()
): Promise<number> => repo.countActiveByEbook(ebookId, now);
