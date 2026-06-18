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

  // ── Device tokens — multi-device child table ws_customer_device_token ──────────
  // Mirrors Mongo Customer.firebaseTokens[] (token-keyed upsert: the token moves
  // to whichever customer last registered it). Also keeps the legacy single
  // `device` column in sync (newest wins) so the Mongo-mirrored read still works.

  /** Register/move a device token to this customer. Returns {count} for 404. */
  setDeviceToken: async (id: number, token: string, platform?: string) => {
    const customer = await prisma.customer.findFirst({
      where: { id, isAccountDeleted: false },
      select: { id: true },
    });
    if (!customer) return { count: 0 };
    await upsertDeviceToken(id, token, platform);
    return { count: 1 };
  },

  /** Remove a single device token (logout on this device). */
  clearDeviceToken: async (id: number, token: string) => {
    await prisma.customerDeviceToken.deleteMany({ where: { customerId: id, token } });
    // Clear the legacy column too if it held this token.
    await prisma.customer.updateMany({
      where: { id, isAccountDeleted: false, firebaseToken: token },
      data: { firebaseToken: null, updatedAt: new Date() },
    });
    return { count: 1 };
  },

  /** Register a device token by phone (post-login sync; no auth context). */
  setDeviceTokenByPhone: async (phone: string, token: string, platform?: string) => {
    const customer = await prisma.customer.findFirst({
      where: { phoneNumber: phone, isAccountDeleted: false },
      select: { id: true },
    });
    if (!customer) return { count: 0 };
    await upsertDeviceToken(customer.id, token, platform);
    return { count: 1 };
  },

  /** All active device tokens for a customer (for FCM fan-out). */
  listDeviceTokens: (id: number) =>
    prisma.customerDeviceToken.findMany({
      where: { customerId: id },
      select: { token: true },
    }),

  /** Prune invalid tokens reported by FCM (mirrors Mongo $pull on dead tokens). */
  pruneDeviceTokens: (tokens: string[]) =>
    prisma.customerDeviceToken.deleteMany({ where: { token: { in: tokens } } }),
};

/**
 * Token-keyed upsert into ws_customer_device_token. The `token` column is
 * UNIQUE, so re-registering an existing token moves it to the new owner +
 * refreshes platform/updatedAt — matching Mongo's two-step $pull/$push. Also
 * mirrors the token into the legacy single `device` column (newest wins).
 */
async function upsertDeviceToken(customerId: number, token: string, platform?: string) {
  const now = new Date();
  const plat = platform === "ios" || platform === "android" ? platform : null;
  await prisma.customerDeviceToken.upsert({
    where: { token },
    update: { customerId, platform: plat ?? undefined, updatedAt: now },
    create: { customerId, token, platform: plat, createdAt: now, updatedAt: now },
  });
  await prisma.customer.updateMany({
    where: { id: customerId, isAccountDeleted: false },
    data: {
      firebaseToken: token,
      ...(plat ? { os_type: plat } : {}),
      updatedAt: now,
    },
  });
}
