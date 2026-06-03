import { config } from "./env.js";

export type ApiJson = {
  success?: boolean;
  code?: number;
  data?: unknown;
  message?: string;
  errors?: unknown;
};

export class ApiTestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message);
    this.name = "ApiTestError";
  }
}

export async function request(
  method: string,
  path: string,
  options: {
    token?: string;
    body?: unknown;
    query?: Record<string, string | number | undefined>;
  } = {}
): Promise<{ status: number; json: ApiJson; raw: string }> {
  const url = new URL(path.startsWith("http") ? path : `${config.baseUrl}${path}`);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const raw = await res.text();
  let json: ApiJson = {};
  try {
    json = raw ? (JSON.parse(raw) as ApiJson) : {};
  } catch {
    throw new ApiTestError(`Non-JSON response (${res.status})`, res.status, raw);
  }

  return { status: res.status, json, raw };
}

export async function requestOk(
  method: string,
  path: string,
  options: Parameters<typeof request>[2] = {}
): Promise<ApiJson> {
  const { status, json } = await request(method, path, options);
  if (status < 200 || status >= 300) {
    throw new ApiTestError(
      `${method} ${path} → ${status}: ${json.message ?? "request failed"}`,
      status,
      json
    );
  }
  if (json.success === false) {
    throw new ApiTestError(`${method} ${path} → success:false`, status, json);
  }
  return json;
}

/** Assert exact HTTP status (e.g. 400 for MySQL-only constraints). */
export async function requestExpectStatus(
  method: string,
  path: string,
  expectedStatus: number,
  options: Parameters<typeof request>[2] = {}
): Promise<ApiJson> {
  const { status, json } = await request(method, path, options);
  if (status !== expectedStatus) {
    throw new ApiTestError(
      `${method} ${path} → expected ${expectedStatus}, got ${status}: ${json.message ?? ""}`,
      status,
      json
    );
  }
  return json;
}
