import { config } from "./env.js";
import { requestOk } from "./http.js";
import { mintAdminToken, mintCustomerToken } from "./mint-auth.js";

export async function assertServerUp(): Promise<void> {
  const res = await fetch(`${config.baseUrl}/healthz`);
  if (!res.ok) {
    throw new Error(`Server not reachable at ${config.baseUrl}/healthz (${res.status}). Run: yarn dev`);
  }
}

export async function getAdminToken(): Promise<string> {
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

/** Customer JWT via OTP (phone must be in TESTING_PHONE_NUMBERS or use static OTP flow). */
export async function getCustomerToken(): Promise<string> {
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

export function requireMysqlModule(moduleKey: string): void {
  if (!config.mysqlModules.includes(moduleKey)) {
    throw new Error(
      `MIGRATION_MYSQL_MODULES must include "${moduleKey}" (current: ${config.mysqlModules.join(", ") || "(empty)"}). Restart yarn dev after .env change.`
    );
  }
}
