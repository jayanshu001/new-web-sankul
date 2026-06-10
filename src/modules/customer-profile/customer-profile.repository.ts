import { prisma } from "../../config/prisma";

/** Prisma persistence for the customer-profile MySQL branch (ws_customer). */
export const customerProfileRepository = {
  /** Active, non-deleted customer by id. */
  findActiveById: (id: number) =>
    prisma.customer.findFirst({ where: { id, isAccountDeleted: false } }),

  /** Used for the profile-picture / device handlers (also require status=true). */
  findLiveById: (id: number) =>
    prisma.customer.findFirst({ where: { id, isAccountDeleted: false, status: true } }),

  /** Email-uniqueness check: another non-deleted customer using this email. */
  emailTakenByOther: (email: string, excludeId: number) =>
    prisma.customer.findFirst({
      where: { emailAddress: email, isAccountDeleted: false, id: { not: excludeId } },
      select: { id: true },
    }),

  /**
   * Hydrate goal int-ids (from the `goal` JSON array) into [{ id, name }] via
   * ws_customer_target_goal. Preserves the order given in the JSON array.
   */
  hydrateGoals: async (ids: number[]) => {
    if (!ids.length) return [];
    const rows = await prisma.customerTargetGoal.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)).filter(Boolean) as { id: number; name: string }[];
  },

  /** Patch arbitrary scalar columns (caller builds the Prisma data object). */
  updateById: (id: number, data: Record<string, unknown>) =>
    prisma.customer.update({ where: { id }, data }),

  /** Soft-delete: mark account deleted + inactive. updateMany → count for 404. */
  softDelete: (id: number) =>
    prisma.customer.updateMany({
      where: { id, isAccountDeleted: false },
      data: { isAccountDeleted: true, status: false, updatedAt: new Date() },
    }),

  /** Set profile picture column. */
  setProfilePicture: (id: number, url: string) =>
    prisma.customer.update({ where: { id }, data: { profile_picture: url, updatedAt: new Date() } }),

  /** Single device token (newest wins) — legacy `device` column semantics. */
  setDeviceToken: (id: number, token: string, platform?: string) =>
    prisma.customer.updateMany({
      where: { id, isAccountDeleted: false },
      data: {
        firebaseToken: token,
        ...(platform === "ios" || platform === "android" ? { os_type: platform } : {}),
        updatedAt: new Date(),
      },
    }),

  /** Clear the device token if it matches (logout on this device). */
  clearDeviceToken: (id: number, token: string) =>
    prisma.customer.updateMany({
      where: { id, isAccountDeleted: false, firebaseToken: token },
      data: { firebaseToken: null, updatedAt: new Date() },
    }),

  /** Set device token by phone (post-login device sync; no auth context). */
  setDeviceTokenByPhone: (phone: string, token: string, platform?: string) =>
    prisma.customer.updateMany({
      where: { phoneNumber: phone, isAccountDeleted: false },
      data: {
        firebaseToken: token,
        ...(platform === "ios" || platform === "android" ? { os_type: platform } : {}),
        updatedAt: new Date(),
      },
    }),
};
