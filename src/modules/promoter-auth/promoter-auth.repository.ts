import { prisma } from "../../config/prisma";

/**
 * Prisma persistence for the promoter-auth MySQL branch.
 * Entity: `ws_promoter`; tokens: `ws_promoter_access_tokens`.
 *
 * Note: ws_promoter has NO last_login_date / last_login_ip columns (the Mongo
 * model wrote them; SQL only has last_seen_at) → login touches last_seen_at.
 */
export const promoterAuthRepository = {
  /** Active, non-deleted promoter by email (login lookup). */
  findActiveByEmail: (email: string) =>
    prisma.promoter.findFirst({
      where: { email: email.toLowerCase().trim(), status: true, is_delete: false },
    }),

  /** Active promoter by id (refresh). */
  findActiveById: (id: number) =>
    prisma.promoter.findFirst({ where: { id, status: true, is_delete: false } }),

  /** Promoter by id regardless of status (profile / change-password). */
  findById: (id: number) => prisma.promoter.findUnique({ where: { id } }),

  /** Record login activity (no last_login_* columns in SQL → use last_seen_at). */
  touchLogin: (id: number) =>
    prisma.promoter.update({
      where: { id },
      data: { lastSeenAt: new Date(), updated_at: new Date() },
    }),

  updatePassword: (id: number, hashed: string) =>
    prisma.promoter.update({
      where: { id },
      data: { password: hashed, updated_at: new Date() },
    }),

  updateProfile: (
    id: number,
    data: { fullName?: string; phone?: string; image?: string }
  ) =>
    prisma.promoter.update({
      where: { id },
      data: {
        ...(data.fullName !== undefined ? { full_name: data.fullName } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.image !== undefined ? { image: data.image } : {}),
        updated_at: new Date(),
      },
    }),

  // ─── Tokens (ws_promoter_access_tokens) ──────────────────────────────────
  createToken: (input: {
    promoterId: number;
    token: string;
    refreshToken: string;
    expiresAt: Date;
  }) =>
    prisma.promoterAccessToken.create({
      data: {
        promoterId: input.promoterId,
        token: input.token,
        refreshToken: input.refreshToken,
        active: true,
        deleted: false,
        created_at: new Date(),
        expires_at: input.expiresAt,
      },
    }),

  findActiveTokenByRefresh: (refreshToken: string, promoterId: number) =>
    prisma.promoterAccessToken.findFirst({
      where: { refreshToken, promoterId, active: true, deleted: false },
    }),

  deactivateToken: (id: number) =>
    prisma.promoterAccessToken.update({
      where: { id },
      data: { active: false, deleted: true },
    }),

  deactivateAllTokens: (promoterId: number) =>
    prisma.promoterAccessToken.updateMany({
      where: { promoterId },
      data: { active: false, deleted: true },
    }),
};
