import { Router, Request, Response } from "express";
import { renderShareRedirect } from "./shareRedirect";
import { decryptShareId } from "../utils/shareId";

const router = Router();

function sendShare(resource: string, deepPath: string) {
  return (req: Request, res: Response) => {
    const id = decryptShareId(String(req.params.cipher || ""), resource);
    if (!id) {
      return res.status(400).type("text/plain").send("Invalid link");
    }
    const { html, nonce } = renderShareRedirect(deepPath, id);
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self' 'nonce-${nonce}'; base-uri 'none'; object-src 'none'`
    );
    res.type("text/html").send(html);
  };
}

// Add new deep-link surfaces here. First arg is this route's own URL segment
// (must match what the service passes to buildShareUrl); second is the in-app
// route path the iOS/Android app registers for that resource.
router.get("/courses/:cipher", sendShare("courses", "course"));
router.get("/books/:cipher", sendShare("books", "book"));
router.get("/ebooks/:cipher", sendShare("ebooks", "ebook"));
router.get("/live-courses/:cipher", sendShare("live-courses", "live-course"));
router.get("/packages/:cipher", sendShare("packages", "package"));
router.get("/test-series/:cipher", sendShare("test-series", "test-series"));
router.get("/educators/:cipher", sendShare("educators", "educator"));

export default router;
