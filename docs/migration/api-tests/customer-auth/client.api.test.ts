import { config } from "../_lib/env.js";
import { assertServerUp, requireMysqlModule } from "../_lib/auth.js";
import { requestOk, request } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";

/**
 * Customer auth (client OTP/token flow) against MySQL.
 *
 * Requires an existing ws_customer row whose phone is in TESTING_PHONE_NUMBERS
 * (so OTP = 5786 and SMS is skipped). Configured via MIGRATION_TEST_CUSTOMER_PHONE
 * (default falls back to TESTING_PHONE_NUMBERS[0]) + MIGRATION_TEST_CUSTOMER_OTP.
 */

type Profile = { id?: string | number; phoneNumber?: string; isProfileCompleted?: boolean };
type AuthData = { user?: Profile; accessToken?: string; refreshToken?: string; isNewUser?: boolean };

const phone = config.customerPhone;
const otp = config.customerOtp;

export async function runCustomerAuthClientApiTests(): Promise<boolean> {
  return runTests("customer-auth (client)", [
    { name: "server healthz", fn: assertServerUp },
    { name: "module enabled in MIGRATION_MYSQL_MODULES", fn: () => requireMysqlModule("customer-auth") },
    {
      name: "test phone configured",
      fn: () => {
        if (!phone) throw new Error("MIGRATION_TEST_CUSTOMER_PHONE / TESTING_PHONE_NUMBERS not set");
      },
    },
    {
      name: "POST /client/auth/otp/generate → ok",
      fn: async () => {
        const json = await requestOk("POST", "/api/v1/client/auth/otp/generate", {
          body: { phoneNumber: phone },
        });
        const data = json.data as { isNewUser?: boolean };
        if (typeof data?.isNewUser !== "boolean") throw new Error("generate: missing isNewUser");
      },
    },
    {
      name: "POST /client/auth/otp/validate (5786) → token + refreshToken + profile",
      fn: async () => {
        // Ensure a fresh OTP exists for this run.
        await requestOk("POST", "/api/v1/client/auth/otp/generate", { body: { phoneNumber: phone } });
        const json = await requestOk("POST", "/api/v1/client/auth/otp/validate", {
          body: { phoneNumber: phone, otp, os_type: "android" },
        });
        const data = json.data as AuthData;
        if (!data.accessToken) throw new Error("validate: no accessToken");
        if (!data.refreshToken) throw new Error("validate: no refreshToken");
        if (!data.user) throw new Error("validate: no user profile");
        // Contract: profile keys present; phone matches (last 10 digits).
        const last10 = phone.replace(/\D/g, "").slice(-10);
        if ((data.user.phoneNumber ?? "").replace(/\D/g, "").slice(-10) !== last10) {
          throw new Error(`validate: profile phone mismatch (${data.user.phoneNumber})`);
        }
        if (typeof data.user.isProfileCompleted !== "boolean") {
          throw new Error("validate: profile missing isProfileCompleted");
        }
        // The minted access token must actually authenticate a protected route.
        const probe = await requestOk("GET", "/api/v1/client/faqs", {
          token: data.accessToken,
          query: { type: "general" },
        });
        if (probe.success === false) throw new Error("validate: issued token rejected by protected route");
      },
    },
    {
      name: "POST /client/auth/token/refresh → working new token pair",
      fn: async () => {
        await requestOk("POST", "/api/v1/client/auth/otp/generate", { body: { phoneNumber: phone } });
        const login = (await requestOk("POST", "/api/v1/client/auth/otp/validate", {
          body: { phoneNumber: phone, otp, os_type: "android" },
        })).data as AuthData;
        const refreshed = (await requestOk("POST", "/api/v1/client/auth/token/refresh", {
          body: { refreshToken: login.refreshToken },
        })).data as AuthData;
        if (!refreshed.accessToken || !refreshed.refreshToken) throw new Error("refresh: missing new token pair");
        if (!refreshed.user) throw new Error("refresh: missing profile");
        // The refreshed access token must authenticate a protected route.
        // (Note: jwt.sign is deterministic per-second for the same payload, so the
        // token *string* may equal the prior one within the same second — the
        // contract is a valid working pair, identical to the legacy Mongo flow.)
        const probe = await request("GET", "/api/v1/client/faqs", { token: refreshed.accessToken });
        if (probe.status !== 200) throw new Error(`refresh: new token rejected (${probe.status})`);
      },
    },
    {
      name: "refresh with a structurally-invalid refresh token → 401",
      fn: async () => {
        const reuse = await request("POST", "/api/v1/client/auth/token/refresh", {
          body: { refreshToken: "not-a-valid-jwt" },
        });
        if (reuse.status !== 401) throw new Error(`invalid refresh token expected 401, got ${reuse.status}`);
      },
    },
    {
      name: "DELETE /client/auth/logout → ok",
      fn: async () => {
        await requestOk("POST", "/api/v1/client/auth/otp/generate", { body: { phoneNumber: phone } });
        const login = (await requestOk("POST", "/api/v1/client/auth/otp/validate", {
          body: { phoneNumber: phone, otp, os_type: "android" },
        })).data as AuthData;
        const json = await requestOk("DELETE", "/api/v1/client/auth/logout", {
          token: login.accessToken,
        });
        if (json.success === false) throw new Error("logout: success:false");
      },
    },
    {
      name: "validate with wrong OTP → 400",
      fn: async () => {
        await requestOk("POST", "/api/v1/client/auth/otp/generate", { body: { phoneNumber: phone } });
        const res = await request("POST", "/api/v1/client/auth/otp/validate", {
          body: { phoneNumber: phone, otp: "0000", os_type: "android" },
        });
        if (res.status !== 400) throw new Error(`wrong OTP expected 400, got ${res.status}`);
      },
    },
  ]);
}
