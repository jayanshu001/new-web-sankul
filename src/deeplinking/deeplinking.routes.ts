import { Router, Request, Response } from "express";
import { renderShareRedirect } from "./shareRedirect";

const router = Router();

const OBJECT_ID = /^[a-f0-9]{24}$/i;

function sendShare(deepPath: string) {
  return (req: Request, res: Response) => {
    const id = String(req.params.id || "");
    if (!OBJECT_ID.test(id)) {
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

// Add new deep-link surfaces here. The first arg to sendShare() is the
// in-app route path the iOS/Android app registers for that resource.
router.get("/courses/:id", sendShare("course"));
router.get("/books/:id", sendShare("book"));
router.get("/ebooks/:id", sendShare("ebook"));
router.get("/live-courses/:id", sendShare("live-course"));
router.get("/packages/:id", sendShare("package"));
router.get("/test-series/:id", sendShare("test-series"));
router.get("/educators/:id", sendShare("educator"));

export default router;
