// Admin RBAC: resolves an admin's effective permission keys for per-request RBAC
// (middlewares/requirePermission.ts). The admin JWT carries only { id, email, role },
// so grants are re-resolved server-side and cached in Redis for a short TTL; edits
// bust the entry. Effective = role grants (ws_role_has_permissions) ∪ direct grants
// (ws_model_has_permissions), the same union buildSqlAdminDto uses for login.

import { redisClient } from "../../config/redis";
import { adminAuthRepository } from "./admin-auth.repository";

const PERM_CACHE_TTL_SECONDS = 60;
const permCacheKey = (adminId: string) => `admin_perms:${adminId}`;

const parseAdminId = (id: string): bigint | null => {
  try {
    const n = BigInt(id);
    return n > BigInt(0) ? n : null;
  } catch {
    return null;
  }
};

const readEffectivePermissionKeys = async (id: bigint): Promise<string[]> => {
  const roles = await adminAuthRepository.findRoles(id);
  const [rolePermissions, directPermissions] = await Promise.all([
    adminAuthRepository.findRolePermissions(roles.map((r) => r.id)),
    adminAuthRepository.findDirectPermissions(id),
  ]);
  return Array.from(
    new Set([...rolePermissions, ...directPermissions].map((p) => p.name))
  );
};

/**
 * Fail-open on a cache read error (falls through to a live DB read); a DB error
 * propagates so the middleware decides, and in shadow mode it must never block.
 */
export const getEffectivePermissionKeys = async (
  adminId: string
): Promise<string[]> => {
  const key = permCacheKey(adminId);
  try {
    const cached = await redisClient.get(key);
    if (cached) return JSON.parse(cached) as string[];
  } catch {
  }

  const id = parseAdminId(adminId);
  const keys = id ? await readEffectivePermissionKeys(id) : [];

  try {
    await redisClient.set(key, JSON.stringify(keys), "EX", PERM_CACHE_TTL_SECONDS);
  } catch {
  }
  return keys;
};

/** Call after editing an admin's role or direct grants. Non-fatal: the TTL expires stale entries. */
export const invalidateAdminPermissions = async (
  adminId: string | number | bigint
): Promise<void> => {
  try {
    await redisClient.del(permCacheKey(String(adminId)));
  } catch {
  }
};

/**
 * Call after editing a role's permission set (affects many admins); cheaper than
 * enumerating members. Uses SCAN to avoid blocking Redis.
 */
export const invalidateAllAdminPermissions = async (): Promise<void> => {
  try {
    let cursor = "0";
    do {
      const [next, batch] = await redisClient.scan(
        cursor,
        "MATCH",
        "admin_perms:*",
        "COUNT",
        100
      );
      cursor = next;
      if (batch.length) await redisClient.del(...batch);
    } while (cursor !== "0");
  } catch {
  }
};
