// PDF browser pool: one shared headless Chromium in THIS process, at most
// MAX_CONCURRENT_PAGES renders at a time. Callers go through renderPdfFromHtml
// (pdfRender.queue.ts), which decides whether this process or the worker renders.
import puppeteer, { type Browser } from "puppeteer";

// One shared headless Chromium; each render opens and closes its own page.
const BROWSER_LAUNCH_OPTIONS = {
  headless: true as const,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
};

let browserPromise: Promise<Browser> | null = null;

// Lazy singleton; cleared on disconnect so the next render relaunches.
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch(BROWSER_LAUNCH_OPTIONS).then((browser) => {
      browser.on("disconnected", () => {
        browserPromise = null;
      });
      return browser;
    });
    browserPromise.catch(() => {
      browserPromise = null;
    });
  }
  return browserPromise;
}

// Optional shutdown hook; safe to leave uncalled.
export async function closePdfBrowser(): Promise<void> {
  const pending = browserPromise;
  browserPromise = null;
  if (!pending) return;
  try {
    const browser = await pending;
    await browser.close();
  } catch {
    // never came up — nothing to close
  }
}

// Bounds concurrent pages on the shared browser; slots are released in a finally.
const MAX_CONCURRENT_PAGES = 3;
let activePages = 0;
const waiters: Array<() => void> = [];

function acquirePageSlot(): Promise<void> {
  if (activePages < MAX_CONCURRENT_PAGES) {
    activePages++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waiters.push(() => {
      activePages++;
      resolve();
    });
  });
}

function releasePageSlot(): void {
  activePages--;
  const next = waiters.shift();
  if (next) next();
}

// Renders on the shared browser, at most MAX_CONCURRENT_PAGES at a time.
export async function renderPdfLocally(html: string): Promise<Buffer> {
  await acquirePageSlot();
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: "load" });
      // Wait for web fonts so the PDF never rasterises with a fallback font lacking
      // Gujarati/Hindi glyphs; capped at 5s so a slow font CDN can't hang the render.
      // The callback runs inside Chromium and must NOT be `async`: tsc (target es2016)
      // downlevels it to `__awaiter`, which is undefined in the browser context.
      await page.evaluate(() =>
        Promise.race([
          (document as any).fonts.ready,
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ])
      );
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "20px", right: "20px", bottom: "20px", left: "20px" },
      });
      return Buffer.from(pdf);
    } finally {
      // Close only the page, never the shared browser.
      await page.close();
    }
  } finally {
    releasePageSlot();
  }
}
