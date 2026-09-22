import { Router, Request, Response } from "express";
import { buildShareTargets, decodeShareId, renderShareRedirect } from "./shareRedirect";
import { success, failure } from "../utils/httpResponse";

const router = Router();

const OBJECT_ID = /^([a-f0-9]{24}|[1-9]\d*)$/i;

// URL segment -> in-app route path. The segment also keys the share-id cipher,
// so it must match what buildShareUrl() was called with.
const SURFACES: Record<string, string> = {
  courses: "course",
  books: "book",
  ebooks: "ebook",
  "live-courses": "live-course",
  packages: "package",
  "test-series": "test-series",
  educators: "educator",
};

/** Token, or a plain id from a link shared before the cipher. */
function resolveId(resource: string, param: string): string | null {
  if (OBJECT_ID.test(param)) return param;
  return decodeShareId(resource, param);
}

function sendShare(resource: string) {
  const deepPath = SURFACES[resource];
  return (req: Request, res: Response) => {
    const id = resolveId(resource, String(req.params.id || ""));
    if (!id) {
      return res.status(400).type("text/plain").send("Invalid id");
    }
    const { html, nonce } = renderShareRedirect(deepPath, id);
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self' 'nonce-${nonce}'; base-uri 'none'; object-src 'none'`
    );
    res.type("text/html").send(html);
  };
}

// Token -> real id, for deep-link handlers that own their own landing page.
// Public like the rest of /share/*: these ids were in the URL until the cipher.
router.get("/resolve/:resource/:token", (req: Request, res: Response) => {
  const resource = String(req.params.resource || "");
  const deepPath = SURFACES[resource];
  if (!deepPath) return failure(res, "Unknown share resource.", 404);

  const id = resolveId(resource, String(req.params.token || ""));
  if (!id) return failure(res, "Invalid share token.", 400);

  return success(res, { resource, id, deepPath, ...buildShareTargets(deepPath, id) });
});

for (const resource of Object.keys(SURFACES)) {
  router.get(`/${resource}/:id`, sendShare(resource));
}

export default router;
