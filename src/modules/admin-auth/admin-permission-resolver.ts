// src/modules/admin-auth/admin-permission-resolver.ts
//
// Resolves an admin's EFFECTIVE permission-key set for per-request RBAC
// enforcement (middlewares/requirePermission.ts). The admin JWT payload carries
// only { id, email, role } — NOT the permission list — so authorization has to
// re-resolve grants server-side. To keep that off the hot path we cache the
// resolved key set in Redis for a short TTL; role/permission/admin edits bust
// the entry so changes take effect within seconds (or immediately on bust).
//
// Effective = permissions granted via the admin's role(s)
// (ws_role_has_permissions) UNIONED with any directly-assigned per-user perms
// (ws_model_has_permissions) — the same union buildSqlAdminDto uses for login.

import { redisClient } from "../../config/redis";
import { adminAuthRepository } from "./admin-auth.repository";

const PERM_CACHE_TTL_SECONDS = 60;
const permCacheKey = (adminId: string) => `admin_perms:${adminId}`;

/** Parse a JWT/route admin id ("52") to bigint; null if not a valid id. */
const parseAdminId = (id: string): bigint | null => {
  try {
    const n = BigInt(id);
    return n > BigInt(0) ? n : null;
  } catch {
    return null;
  }
};

/**
 * Live DB read of an admin's effective permission keys (role grants + direct
 * grants), flattened + de-duplicated. Returns [] for an unknown/no-grant admin.
 */
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
 * Effective permission keys for an admin, cached in Redis for
 * PERM_CACHE_TTL_SECONDS. Fail-open on a cache read error (falls through to a
 * live DB read); a live DB error propagates to the caller (the middleware
 * decides how to react — in shadow mode it must never block).
 */
export const getEffectivePermissionKeys = async (
  adminId: string
): Promise<string[]> => {
  const key = permCacheKey(adminId);
  try {
    const cached = await redisClient.get(key);
    if (cached) return JSON.parse(cached) as string[];
  } catch {
    // Redis miss/unreachable → fall through to a live read.
  }

  const id = parseAdminId(adminId);
  const keys = id ? await readEffectivePermissionKeys(id) : [];

  try {
    await redisClient.set(key, JSON.stringify(keys), "EX", PERM_CACHE_TTL_SECONDS);
  } catch {
    // Best-effort cache; ignore write failures.
  }
  return keys;
};

/**
 * Drop an admin's cached permission set so a role/permission/grant change takes
 * effect immediately. Call after editing an admin's role assignment or direct
 * grants. Non-fatal on failure — the TTL expires the stale entry shortly anyway.
 */
export const invalidateAdminPermissions = async (
  adminId: string | number | bigint
): Promise<void> => {
  try {
    await redisClient.del(permCacheKey(String(adminId)));
  } catch {
    // Non-fatal: TTL will expire the stale entry.
  }
};

/**
 * Drop EVERY admin's cached permission set. Call after editing a *role's*
 * permission set (which can affect many admins at once) — cheaper and simpler
 * than enumerating the role's members. Uses a SCAN to avoid blocking Redis.
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
    // Non-fatal: TTLs will expire stale entries within PERM_CACHE_TTL_SECONDS.
  }
};
