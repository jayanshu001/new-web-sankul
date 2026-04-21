import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Promoter } from "../../models/promoter/Promoter.model";
import { PromoterAccessToken } from "../../models/promoter/PromoterAccessToken.model";
import { redisClient } from "../../config/redis";

const JWT_SECRET = process.env.JWT_ACCESS_SECRET as string;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET as string;
const JWT_ACCESS_TTL_DAYS = 1;
const JWT_REFRESH_TTL_DAYS = 30;
const SALT_ROUNDS = 10;

const addDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

const buildProfile = (p: any) => ({
  id: p._id,
  fullName: p.fullName,
  email: p.email,
  phone: p.phone,
  image: p.image ?? "",
  status: p.status,
});

export async function promoterLogin(email: string, password: string, ip?: string) {
  const promoter = await Promoter.findOne({
    email: email.toLowerCase().trim(),
    status: true,
    isDelete: false,
  }).select("+password");
  if (!promoter) return { ok: false, message: "Invalid email or password." };
  if (!promoter.password) return { ok: false, message: "Account has no password set." };

  const match = await bcrypt.compare(password, promoter.password);
  if (!match) return { ok: false, message: "Invalid email or password." };

  await PromoterAccessToken.updateMany(
    { promoterId: promoter._id },
    { active: false, deleted: true }
  );

  promoter.lastLoginDate = new Date();
  if (ip) promoter.lastLoginIp = ip;
  await promoter.save();

  const token = jwt.sign(
    { id: promoter._id.toString(), email: promoter.email, role: "promoter", type: "promoter" },
    JWT_SECRET,
    { expiresIn: `${JWT_ACCESS_TTL_DAYS}d` }
  );
  const refreshToken = jwt.sign(
    { id: promoter._id.toString(), email: promoter.email, role: "promoter", type: "promoter" },
    JWT_REFRESH_SECRET,
    { expiresIn: `${JWT_REFRESH_TTL_DAYS}d` }
  );

  await PromoterAccessToken.create({
    promoterId: promoter._id,
    token,
    refreshToken,
    active: true,
    deleted: false,
    expiresAt: addDays(JWT_REFRESH_TTL_DAYS),
  });

  await redisClient.set(
    `promoter_session:${promoter._id.toString()}`,
    token,
    "EX",
    JWT_ACCESS_TTL_DAYS * 24 * 60 * 60
  );

  return {
    ok: true,
    message: "Login successful.",
    token,
    refreshToken,
    promoter: buildProfile(promoter),
  };
}

export async function promoterRefresh(refreshToken: string) {
  if (!refreshToken) return { ok: false, message: "Refresh token is required." };
  try {
    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET) as any;
    const promoterId = decoded.id;

    const db = await PromoterAccessToken.findOne({
      refreshToken,
      promoterId,
      active: true,
      deleted: false,
    });
    if (!db) return { ok: false, message: "Invalid or revoked refresh token." };

    const promoter = await Promoter.findOne({
      _id: promoterId,
      status: true,
      isDelete: false,
    });
    if (!promoter) return { ok: false, message: "Promoter not found or disabled." };

    await PromoterAccessToken.updateOne({ _id: db._id }, { active: false, deleted: true });

    const newToken = jwt.sign(
      { id: promoter._id.toString(), email: promoter.email, role: "promoter", type: "promoter" },
      JWT_SECRET,
      { expiresIn: `${JWT_ACCESS_TTL_DAYS}d` }
    );
    const newRefreshToken = jwt.sign(
      { id: promoter._id.toString(), email: promoter.email, role: "promoter", type: "promoter" },
      JWT_REFRESH_SECRET,
      { expiresIn: `${JWT_REFRESH_TTL_DAYS}d` }
    );

    await PromoterAccessToken.create({
      promoterId: promoter._id,
      token: newToken,
      refreshToken: newRefreshToken,
      active: true,
      deleted: false,
      expiresAt: addDays(JWT_REFRESH_TTL_DAYS),
    });
    await redisClient.set(
      `promoter_session:${promoter._id.toString()}`,
      newToken,
      "EX",
      JWT_ACCESS_TTL_DAYS * 24 * 60 * 60
    );

    return {
      ok: true,
      message: "Token refreshed successfully.",
      token: newToken,
      refreshToken: newRefreshToken,
      promoter: buildProfile(promoter),
    };
  } catch {
    return { ok: false, message: "Invalid or expired refresh token." };
  }
}

export async function promoterLogout(promoterId: string) {
  await PromoterAccessToken.updateMany({ promoterId }, { active: false, deleted: true });
  await redisClient.del(`promoter_session:${promoterId}`);
  return { ok: true, message: "Successfully logged out." };
}

export async function promoterChangePassword(
  promoterId: string,
  currentPassword: string,
  newPassword: string
) {
  const promoter = await Promoter.findById(promoterId).select("+password");
  if (!promoter) return { ok: false, message: "Promoter not found." };
  if (!promoter.password) return { ok: false, message: "No current password set." };

  const match = await bcrypt.compare(currentPassword, promoter.password);
  if (!match) return { ok: false, message: "Current password is incorrect." };

  promoter.password = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await promoter.save();
  return { ok: true, message: "Password updated successfully." };
}

export async function promoterUpdateProfile(
  promoterId: string,
  data: { fullName?: string; phone?: string; image?: string }
) {
  const promoter = await Promoter.findById(promoterId);
  if (!promoter) return { ok: false, message: "Promoter not found." };

  if (data.fullName !== undefined) promoter.fullName = data.fullName;
  if (data.phone !== undefined) promoter.phone = data.phone;
  if (data.image !== undefined) promoter.image = data.image;
  await promoter.save();
  return { ok: true, message: "Profile updated.", promoter: buildProfile(promoter) };
}

export async function promoterGetProfile(promoterId: string) {
  const promoter = await Promoter.findById(promoterId);
  if (!promoter) return { ok: false, message: "Promoter not found." };
  return { ok: true, message: "ok", promoter: buildProfile(promoter) };
}
