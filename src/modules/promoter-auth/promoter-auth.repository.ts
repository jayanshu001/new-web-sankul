// Promoter auth: Prisma queries.
import { prisma } from "../../config/prisma";

export const promoterAuthRepository = {
  findActiveByEmail: (email: string) =>
    prisma.promoter.findFirst({
      where: { email: email.toLowerCase().trim(), status: true, is_delete: false },
    }),

  findActiveById: (id: number) =>
    prisma.promoter.findFirst({ where: { id, status: true, is_delete: false } }),

  /** Regardless of status (profile / change-password). */
  findById: (id: number) => prisma.promoter.findUnique({ where: { id } }),

  /** ws_promoter has no last_login_* columns, so login touches last_seen_at. */
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
