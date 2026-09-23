import { config } from "./env.js";
import { requestOk } from "./http.js";
import { mintAdminToken, mintCustomerToken } from "./mint-auth.js";
import { storedAdminToken, storedCustomerToken } from "./token-store.js";

export async function assertServerUp(): Promise<void> {
  const res = await fetch(`${config.baseUrl}/healthz`);
  if (!res.ok) {
    throw new Error(`Server not reachable at ${config.baseUrl}/healthz (${res.status}). Run: yarn dev`);
  }
}

/**
 * Admin JWT for authenticated APIs.
 *
 * Default: use the mock JWT persisted in api-tests/.auth.json (minted once
 * before the suites run). Set MIGRATION_TEST_REAL_LOGIN=true to instead log in
 * with real credentials / OTP.
 */
export async function getAdminToken(): Promise<string> {
  if (!config.realLogin) return storedAdminToken();
  if (config.adminEmail && config.adminPassword) {
    try {
      const json = await requestOk("POST", "/api/v1/admin/auth/login", {
        body: { email: config.adminEmail, password: config.adminPassword },
      });
      const token = (json.data as { accessToken?: string })?.accessToken;
      if (token) return token;
    } catch {
      console.warn("  (admin login failed — using minted test JWT + Redis)");
    }
  }
  return mintAdminToken();
}

/**
 * Customer JWT for authenticated APIs.
 *
 * Default: the mock JWT from api-tests/.auth.json. Set
 * MIGRATION_TEST_REAL_LOGIN=true to instead authenticate via the OTP flow.
 */
export async function getCustomerToken(): Promise<string> {
  if (!config.realLogin) return storedCustomerToken();
  if (config.customerPhone) {
    try {
      await requestOk("POST", "/api/v1/client/auth/otp/generate", {
        body: { phoneNumber: config.customerPhone },
      });
      const json = await requestOk("POST", "/api/v1/client/auth/otp/validate", {
        body: {
          phoneNumber: config.customerPhone,
          otp: config.customerOtp,
          os_type: "android",
        },
      });
      const token = (json.data as { accessToken?: string })?.accessToken;
      if (token) return token;
    } catch {
      console.warn("  (OTP flow failed — using minted test JWT + Redis)");
    }
  }
  return mintCustomerToken();
}

/**
 * Legacy per-module MySQL gate. Mongo removal is complete, so every module now
 * runs on MySQL and this check is always satisfied. Retained (as a no-op unless an
 * explicit MIGRATION_MYSQL_MODULES CSV narrows the run) so the many test files that
 * call it keep compiling and reading clearly.
 */
export function requireMysqlModule(moduleKey: string): void {
  if (!config.mysqlModules.includes(moduleKey)) {
    throw new Error(
      `MIGRATION_MYSQL_MODULES was set but does not include "${moduleKey}" (current: ${config.mysqlModules.join(", ")}). Unset it to run all modules.`
    );
  }
}
