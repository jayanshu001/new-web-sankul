import { prisma } from "../../config/prisma";
import { parseLabels, type GoalSelection } from "../../utils/goalSelection";

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
   * Hydrate goal selections (from the `goal` JSON) into
   * [{ id, name, labels: [{ id, name }] }] via ws_customer_target_goal. Each
   * goal carries ONLY the labels the customer selected. Unknown goals are
   * dropped; order follows the stored selection.
   */
  hydrateGoals: async (selections: GoalSelection[]) => {
    if (!selections.length) return [];
    const rows = await prisma.customerTargetGoal.findMany({
      where: { id: { in: selections.map((s) => s.goalId) } },
      select: { id: true, name: true, labels: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return selections
      .map((sel) => {
        const row = byId.get(sel.goalId);
        if (!row) return null;
        const chosen = new Set(sel.labelIds);
        return {
          id: row.id,
          name: row.name,
          labels: parseLabels(row.labels).filter((l) => chosen.has(l.id)),
        };
      })
      .filter(Boolean) as { id: number; name: string; labels: { id: number; name: string }[] }[];
  },

  /** Target goals (id + labels) for the given ids — used to validate writes. */
  targetGoalsByIds: (ids: number[]) =>
    ids.length
      ? prisma.customerTargetGoal.findMany({ where: { id: { in: ids } }, select: { id: true, labels: true } })
      : Promise.resolve([] as { id: number; labels: unknown }[]),

  /** Patch arbitrary scalar columns (caller builds the Prisma data object). */
  updateById: (id: number, data: Record<string, unknown>) =>
    prisma.customer.update({ where: { id }, data }),

  /**
   * Soft-delete: mark account deleted + inactive. updateMany → count for 404.
   *
   * Also clears `download_key_hex` in the same statement. The row survives the
   * soft delete, so secret key material would otherwise sit there forever; and
   * nothing can legitimately ask for it back — a soft-deleted customer can never
   * authenticate again, and a re-signup on the same phone lands on a NEW
   * customer id.
   */
  softDelete: (id: number) =>
    prisma.customer.updateMany({
      where: { id, isAccountDeleted: false },
      data: { isAccountDeleted: true, status: false, downloadKeyHex: null, updatedAt: new Date() },
    }),

  /** Set profile picture column. */
  setProfilePicture: (id: number, url: string) =>
    prisma.customer.update({ where: { id }, data: { profile_picture: url, updatedAt: new Date() } }),

  // ── Device token — single column ws_customer.device (firebaseToken) ───────────
  // One token per customer (last device wins): registering a new token overwrites
  // the previous one. Re-registering the same token elsewhere moves it (the token
  // is cleared from any other customer that still held it) to mirror the old
  // token-keyed ownership semantics without a separate table.

  /** Register/move a device token to this customer. Returns {count} for 404. */
  setDeviceToken: async (id: number, token: string, platform?: string) => {
    const customer = await prisma.customer.findFirst({
      where: { id, isAccountDeleted: false },
      select: { id: true },
    });
    if (!customer) return { count: 0 };
    await writeDeviceToken(id, token, platform);
    return { count: 1 };
  },

  /** Remove this device token (logout on this device). */
  clearDeviceToken: async (id: number, token: string) => {
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
    await writeDeviceToken(customer.id, token, platform);
    return { count: 1 };
  },

  /** Prune invalid tokens reported by FCM (mirrors Mongo $pull on dead tokens). */
  pruneDeviceTokens: (tokens: string[]) =>
    prisma.customer.updateMany({
      where: { firebaseToken: { in: tokens } },
      data: { firebaseToken: null, updatedAt: new Date() },
    }),
};

/**
 * Write the device token into ws_customer.device (single column, last-device-
 * wins). First clears the token from any OTHER customer that still held it, so a
 * handset re-registering under a new account can't leave the token double-owned
 * (mirrors the old token-keyed ownership move without a separate table).
 */
async function writeDeviceToken(customerId: number, token: string, platform?: string) {
  const now = new Date();
  const plat = platform === "ios" || platform === "android" ? platform : null;
  await prisma.customer.updateMany({
    where: { firebaseToken: token, id: { not: customerId } },
    data: { firebaseToken: null, updatedAt: now },
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
