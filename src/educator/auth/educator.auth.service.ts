import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { CourseEducator } from "../../models/course/CourseEducator.model";
import { EducatorAccessToken } from "../../models/educator/EducatorAccessToken.model";
import { redisClient } from "../../config/redis";

const JWT_SECRET = process.env.JWT_ACCESS_SECRET as string;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET as string;
const JWT_ACCESS_TTL_DAYS = 1;
const JWT_REFRESH_TTL_DAYS = 30;
const SALT_ROUNDS = 10;

const addDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

const buildProfile = (e: any) => ({
  id: e._id,
  name: e.name,
  email: e.email,
  image: e.image ?? "",
  about: e.about ?? "",
  view: e.view ?? 0,
  status: e.status,
});

export async function educatorLogin(email: string, password: string) {
  const educator = await CourseEducator.findOne({
    email: email.toLowerCase().trim(),
    status: true,
  });
  if (!educator) return { ok: false, message: "Invalid email or password." };

  if (!educator.password) return { ok: false, message: "Account has no password set." };

  const match = await bcrypt.compare(password, educator.password);
  if (!match) return { ok: false, message: "Invalid email or password." };

  await EducatorAccessToken.updateMany(
    { educatorId: educator._id },
    { active: false, deleted: true }
  );

  const token = jwt.sign(
    { id: educator._id.toString(), email: educator.email, role: "educator", type: "educator" },
    JWT_SECRET,
    { expiresIn: `${JWT_ACCESS_TTL_DAYS}d` }
  );
  const refreshToken = jwt.sign(
    { id: educator._id.toString(), email: educator.email, role: "educator", type: "educator" },
    JWT_REFRESH_SECRET,
    { expiresIn: `${JWT_REFRESH_TTL_DAYS}d` }
  );

  await EducatorAccessToken.create({
    educatorId: educator._id,
    token,
    refreshToken,
    active: true,
    deleted: false,
    expiresAt: addDays(JWT_REFRESH_TTL_DAYS),
  });

  await redisClient.set(
    `educator_session:${educator._id.toString()}`,
    token,
    "EX",
    JWT_ACCESS_TTL_DAYS * 24 * 60 * 60
  );

  return {
    ok: true,
    message: "Login successful.",
    token,
    refreshToken,
    educator: buildProfile(educator),
  };
}

export async function educatorRefresh(refreshToken: string) {
  if (!refreshToken) return { ok: false, message: "Refresh token is required." };
  try {
    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET) as any;
    const educatorId = decoded.id;

    const db = await EducatorAccessToken.findOne({
      refreshToken,
      educatorId,
      active: true,
      deleted: false,
    });
    if (!db) return { ok: false, message: "Invalid or revoked refresh token." };

    const educator = await CourseEducator.findOne({ _id: educatorId, status: true });
    if (!educator) return { ok: false, message: "Educator not found or disabled." };

    await EducatorAccessToken.updateOne({ _id: db._id }, { active: false, deleted: true });

    const newToken = jwt.sign(
      { id: educator._id.toString(), email: educator.email, role: "educator", type: "educator" },
      JWT_SECRET,
      { expiresIn: `${JWT_ACCESS_TTL_DAYS}d` }
    );
    const newRefreshToken = jwt.sign(
      { id: educator._id.toString(), email: educator.email, role: "educator", type: "educator" },
      JWT_REFRESH_SECRET,
      { expiresIn: `${JWT_REFRESH_TTL_DAYS}d` }
    );

    await EducatorAccessToken.create({
      educatorId: educator._id,
      token: newToken,
      refreshToken: newRefreshToken,
      active: true,
      deleted: false,
      expiresAt: addDays(JWT_REFRESH_TTL_DAYS),
    });
    await redisClient.set(
      `educator_session:${educator._id.toString()}`,
      newToken,
      "EX",
      JWT_ACCESS_TTL_DAYS * 24 * 60 * 60
    );

    return {
      ok: true,
      message: "Token refreshed successfully.",
      token: newToken,
      refreshToken: newRefreshToken,
      educator: buildProfile(educator),
    };
  } catch {
    return { ok: false, message: "Invalid or expired refresh token." };
  }
}

export async function educatorLogout(educatorId: string) {
  await EducatorAccessToken.updateMany(
    { educatorId },
    { active: false, deleted: true }
  );
  await redisClient.del(`educator_session:${educatorId}`);
  return { ok: true, message: "Successfully logged out." };
}

export async function educatorChangePassword(
  educatorId: string,
  currentPassword: string,
  newPassword: string
) {
  const educator = await CourseEducator.findById(educatorId);
  if (!educator) return { ok: false, message: "Educator not found." };
  if (!educator.password) return { ok: false, message: "No current password set." };

  const match = await bcrypt.compare(currentPassword, educator.password);
  if (!match) return { ok: false, message: "Current password is incorrect." };

  educator.password = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await educator.save();
  return { ok: true, message: "Password updated successfully." };
}

export async function educatorUpdateProfile(
  educatorId: string,
  data: { name?: string; about?: string; image?: string }
) {
  const educator = await CourseEducator.findById(educatorId);
  if (!educator) return { ok: false, message: "Educator not found." };

  if (data.name !== undefined) educator.name = data.name;
  if (data.about !== undefined) educator.about = data.about;
  if (data.image !== undefined) educator.image = data.image;
  await educator.save();
  return { ok: true, message: "Profile updated.", educator: buildProfile(educator) };
}

export async function educatorGetProfile(educatorId: string) {
  const educator = await CourseEducator.findById(educatorId);
  if (!educator) return { ok: false, message: "Educator not found." };
  return { ok: true, message: "ok", educator: buildProfile(educator) };
}
