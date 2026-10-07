// Customer profile: Prisma queries for profile, goals, account delete and device tokens.
import { prisma } from "../../config/prisma";
import { parseLabels, type GoalSelection } from "../../utils/goalSelection";

export const customerProfileRepository = {
  findActiveById: (id: number) =>
    prisma.customer.findFirst({ where: { id, isAccountDeleted: false } }),

  /** Also requires status=true (profile-picture / device handlers). */
  findLiveById: (id: number) =>
    prisma.customer.findFirst({ where: { id, isAccountDeleted: false, status: true } }),

  emailTakenByOther: (email: string, excludeId: number) =>
    prisma.customer.findFirst({
      where: { emailAddress: email, isAccountDeleted: false, id: { not: excludeId } },
      select: { id: true },
    }),

  /**
   * Each goal carries only the labels the customer selected. Unknown goals are
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

  targetGoalsByIds: (ids: number[]) =>
    ids.length
      ? prisma.customerTargetGoal.findMany({ where: { id: { in: ids } }, select: { id: true, labels: true } })
      : Promise.resolve([] as { id: number; labels: unknown }[]),

  updateById: (id: number, data: Record<string, unknown>) =>
    prisma.customer.update({ where: { id }, data }),

  /**
   * Also clears `download_key_hex`: the row survives the soft delete, and nothing
   * can legitimately read the key again (the customer can never authenticate, and
   * a re-signup on the same phone gets a new customer id).
   */
  softDelete: (id: number) =>
    prisma.customer.updateMany({
      where: { id, isAccountDeleted: false },
      data: { isAccountDeleted: true, status: false, downloadKeyHex: null, updatedAt: new Date() },
    }),

  setProfilePicture: (id: number, url: string) =>
    prisma.customer.update({ where: { id }, data: { profile_picture: url, updatedAt: new Date() } }),

  // Device token lives in the single ws_customer.device column: last device wins.

  /** Returns {count} for 404. */
  setDeviceToken: async (id: number, token: string, platform?: string) => {
    const customer = await prisma.customer.findFirst({
      where: { id, isAccountDeleted: false },
      select: { id: true },
    });
    if (!customer) return { count: 0 };
    await writeDeviceToken(id, token, platform);
    return { count: 1 };
  },

  clearDeviceToken: async (id: number, token: string) => {
    await prisma.customer.updateMany({
      where: { id, isAccountDeleted: false, firebaseToken: token },
      data: { firebaseToken: null, updatedAt: new Date() },
    });
    return { count: 1 };
  },

  /** Post-login sync; no auth context. */
  setDeviceTokenByPhone: async (phone: string, token: string, platform?: string) => {
    const customer = await prisma.customer.findFirst({
      where: { phoneNumber: phone, isAccountDeleted: false },
      select: { id: true },
    });
    if (!customer) return { count: 0 };
    await writeDeviceToken(customer.id, token, platform);
    return { count: 1 };
  },

  /** Prune tokens FCM reported as invalid. */
  pruneDeviceTokens: (tokens: string[]) =>
    prisma.customer.updateMany({
      where: { firebaseToken: { in: tokens } },
      data: { firebaseToken: null, updatedAt: new Date() },
    }),
};

/**
 * First clears the token from any other customer still holding it, so a handset
 * re-registering under a new account can't leave the token double-owned.
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
