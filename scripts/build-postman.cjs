/* eslint-disable */
// Generates two Postman v2.1 collections (Admin + Client), module-wise folders.
// - Uses {{BASEURL}} variable instead of hardcoded host.
// - Collection-level Bearer auth with {{token}}; every authed request inherits it.
// - Public endpoints (login/otp/webhooks/refresh) use noauth.
// - Admin/Client login requests carry a test script that auto-stores the token.
const fs = require("fs");
const path = require("path");

// ---- Data: extracted endpoints ----
const admin = require("./postman-data-admin.json");
const client = require("./postman-data-client.json");

function bodyToRaw(obj) {
  return JSON.stringify(obj, null, 2);
}

// Build a Postman request item from an endpoint descriptor.
function makeItem(ep, loginScriptFor) {
  // Split path into segments; treat :param as Postman path variable {{param}} placeholder style :param.
  const cleanPath = ep.path.replace(/^\//, "");
  const segments = cleanPath.split("/");

  const url = {
    raw: `{{BASEURL}}/${cleanPath}`,
    host: ["{{BASEURL}}"],
    path: segments,
  };

  const request = {
    method: ep.method,
    header: [],
    url,
  };

  // Auth: authed => inherit (omit auth block so collection-level applies).
  // public => explicit noauth.
  if (!ep.auth) {
    request.auth = { type: "noauth" };
  }

  // Body
  if (ep.contentType === "json" && ep.body && Object.keys(ep.body || {}).length >= 0) {
    if (ep.body && Object.keys(ep.body).length > 0) {
      request.header.push({ key: "Content-Type", value: "application/json" });
      request.body = {
        mode: "raw",
        raw: bodyToRaw(ep.body),
        options: { raw: { language: "json" } },
      };
    } else if (["POST", "PUT", "PATCH"].includes(ep.method)) {
      // empty-body write request
      request.header.push({ key: "Content-Type", value: "application/json" });
      request.body = {
        mode: "raw",
        raw: "{}",
        options: { raw: { language: "json" } },
      };
    }
  } else if (ep.contentType === "multipart") {
    // Build formdata from body sample. file-ish values become type:file.
    const fd = [];
    const b = ep.body || {};
    for (const [k, v] of Object.entries(b)) {
      const isFile =
        typeof v === "string" &&
        /file|pdf|image|thumbnail|icon|audio|url \(|^file$/i.test(String(v));
      if (isFile && /file|pdf|^file$|image|thumbnail|icon|audio/i.test(String(v))) {
        fd.push({ key: k, type: "file", src: [] });
      } else {
        fd.push({ key: k, value: String(v), type: "text" });
      }
    }
    if (fd.length === 0) {
      fd.push({ key: "field", value: "value", type: "text" });
    }
    request.body = { mode: "formdata", formdata: fd };
  }

  const item = {
    name: `${ep.method} ${ep.name}`,
    request,
    response: [],
  };

  // Attach login-token capture script if this is a login endpoint.
  if (loginScriptFor) {
    item.event = [
      {
        listen: "test",
        script: {
          type: "text/javascript",
          exec: loginScriptFor,
        },
      },
    ];
  }

  return item;
}

// Group endpoints into folders (preserving first-seen order).
function buildFolders(endpoints, loginMatcher) {
  const folderOrder = [];
  const folderMap = new Map();

  for (const ep of endpoints) {
    const folder = ep.folder || "Misc";
    if (!folderMap.has(folder)) {
      folderMap.set(folder, []);
      folderOrder.push(folder);
    }
    const loginScript = loginMatcher(ep);
    folderMap.get(folder).push(makeItem(ep, loginScript));
  }

  return folderOrder.map((name) => ({
    name: name,
    item: folderMap.get(name),
  }));
}

// Token-capture test script. Tries several common response shapes.
function tokenCaptureScript() {
  return [
    "// Auto-store auth token after a successful login.",
    "try {",
    "  const json = pm.response.json();",
    "  const d = json.data || json;",
    "  const token =",
    "    d.token || d.accessToken || d.access_token ||",
    "    (d.tokens && (d.tokens.access || d.tokens.accessToken)) ||",
    "    (d.auth && d.auth.token) || json.token || json.accessToken;",
    "  const refresh =",
    "    d.refreshToken || d.refresh_token ||",
    "    (d.tokens && (d.tokens.refresh || d.tokens.refreshToken)) || json.refreshToken;",
    "  if (token) {",
    "    pm.collectionVariables.set('token', token);",
    "    console.log('Saved token to collection variable {{token}}');",
    "  } else {",
    "    console.warn('Login response had no recognizable token field; set {{token}} manually.');",
    "  }",
    "  if (refresh) pm.collectionVariables.set('refreshToken', refresh);",
    "} catch (e) {",
    "  console.warn('Could not parse login response as JSON:', e.message);",
    "}",
  ];
}

function buildCollection(name, description, endpoints, loginMatcher) {
  return {
    info: {
      _postman_id: undefined, // Postman fills this on import
      name: name,
      description: description,
      schema:
        "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: buildFolders(endpoints, loginMatcher),
    auth: {
      type: "bearer",
      bearer: [{ key: "token", value: "{{token}}", type: "string" }],
    },
    event: [],
    variable: [
      { key: "BASEURL", value: "", type: "string" },
      { key: "token", value: "", type: "string" },
      { key: "refreshToken", value: "", type: "string" },
    ],
  };
}

// Login matchers: return script array if endpoint is a login, else null.
const adminLoginMatcher = (ep) =>
  ep.path === "/api/v1/admin/auth/login" && ep.method === "POST"
    ? tokenCaptureScript()
    : null;

const clientLoginMatcher = (ep) =>
  ep.path === "/api/v1/client/auth/otp/validate" && ep.method === "POST"
    ? tokenCaptureScript()
    : null;

const adminCollection = buildCollection(
  "WebSankul — Admin API",
  "Module-wise Admin API collection.\n\n## Setup\n1. Create a Postman **Environment** and set `BASEURL` (e.g. `http://192.168.0.5/api/v1` is WRONG — use just the host root WITHOUT the path, e.g. `http://192.168.0.5` ... actually BASEURL must be the host+scheme only because each request already includes `/api/v1/admin/...`). Example value: `http://192.168.0.5` or `https://api.websankul.com`.\n2. Run **Auth > POST Admin Login**. A test script auto-saves the JWT into the collection variable `{{token}}`.\n3. All other requests inherit Bearer `{{token}}` automatically.\n\nAuth: collection-level Bearer with `{{token}}`. Public routes (login/refresh) use No Auth.",
  admin,
  adminLoginMatcher
);

const clientCollection = buildCollection(
  "WebSankul — Client API",
  "Module-wise Client (Mobile/Web) API collection.\n\n## Setup\n1. Create a Postman **Environment** and set `BASEURL` to the host root (scheme + host, NO path), e.g. `http://192.168.0.5` or `https://api.websankul.com`. Each request already includes `/api/v1/client/...`.\n2. Run **auth > POST Validate OTP** (or your login flow). A test script auto-saves the JWT into `{{token}}`.\n3. All authed requests inherit Bearer `{{token}}`. Public routes (otp/refresh/webhooks) use No Auth.",
  client,
  clientLoginMatcher
);

const outDir = path.join(process.cwd(), "docs", "postman");
fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(
  path.join(outDir, "WebSankul-Admin.postman_collection.json"),
  JSON.stringify(adminCollection, null, 2)
);
fs.writeFileSync(
  path.join(outDir, "WebSankul-Client.postman_collection.json"),
  JSON.stringify(clientCollection, null, 2)
);

const countItems = (c) => c.item.reduce((n, f) => n + f.item.length, 0);
console.log(
  `Admin: ${adminCollection.item.length} folders, ${countItems(
    adminCollection
  )} requests`
);
console.log(
  `Client: ${clientCollection.item.length} folders, ${countItems(
    clientCollection
  )} requests`
);
console.log(`Written to ${outDir}`);
