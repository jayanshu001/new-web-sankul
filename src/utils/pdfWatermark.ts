// src/utils/pdfWatermark.ts
//
// Stamps the websankul.com watermark on every page of a PDF before it is
// uploaded (govt-jobs documents + previous papers — opt-in per route, see
// `watermarkPdfs` in middlewares/upload.ts). Two marks per page:
//
//   1. the official WebSankul logo, large and very faint, along the page
//      diagonal, and
//   2. a small "Downloaded from websankul.com" badge with the site icon,
//      bottom-right, that is also a clickable link to the site.
//
// Everything is drawn in the page's *visual* space (crop box, after /Rotate),
// so landscape scans and rotated pages get an upright watermark too.

import {
  PDFDict,
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFName,
  PDFPage,
  PDFString,
  StandardFonts,
  degrees,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
} from "pdf-lib";
import { ICON_PNG, LOGO_PNG } from "./pdfWatermark.assets";

const SITE_URL = "https://websankul.com";
const WATERMARK_TEXT = "websankul.com";

// Brand palette — same tokens as the storefront (websankul-jobs globals.css).
const BRAND = rgb(0x36 / 255, 0x76 / 255, 0xbb / 255); // --color-primary
const BRAND_DARK = rgb(0x24 / 255, 0x5a / 255, 0x96 / 255); // --color-primary-dark
const MUTED = rgb(0x6b / 255, 0x72 / 255, 0x80 / 255);
const WHITE = rgb(1, 1, 1);

// Info-dictionary key that marks a file as already stamped, so a re-upload of
// a downloaded paper doesn't get a second watermark on top of the first.
const MARKER_KEY = PDFName.of("WebsankulWatermark");

type Box = { x: number; y: number; width: number; height: number };
type Matrix = readonly [number, number, number, number, number, number];
type Brand = { regular: PDFFont; bold: PDFFont; logo: PDFImage; icon: PDFImage };

/** /Rotate normalised to 0 | 90 | 180 | 270. */
const pageRotation = (page: PDFPage): number => {
  const angle = Math.round(page.getRotation().angle / 90) * 90;
  return ((angle % 360) + 360) % 360;
};

/**
 * Matrix mapping visual (as-displayed) coordinates onto the page's user space
 * for a given crop box and /Rotate, plus the visual width/height.
 */
const visualSpace = (
  box: Box,
  rotation: number
): { width: number; height: number; matrix: Matrix } => {
  const { x, y, width: w, height: h } = box;
  switch (rotation) {
    case 90:
      return { width: h, height: w, matrix: [0, 1, -1, 0, x + w, y] };
    case 180:
      return { width: w, height: h, matrix: [-1, 0, 0, -1, x + w, y + h] };
    case 270:
      return { width: h, height: w, matrix: [0, -1, 1, 0, x, y + h] };
    default:
      return { width: w, height: h, matrix: [1, 0, 0, 1, x, y] };
  }
};

const applyMatrix = (m: Matrix, px: number, py: number): [number, number] => [
  m[0] * px + m[2] * py + m[4],
  m[1] * px + m[3] * py + m[5],
];

/** Rounded "pill" outline in SVG path syntax (y-down, origin top-left). */
const pillPath = (w: number, h: number): string => {
  const r = h / 2;
  return `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
};

const drawDiagonal = (page: PDFPage, brand: Brand, vw: number, vh: number) => {
  const angle = Math.atan2(vh, vw);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  // Logo spans ~55% of the diagonal, centred on the page.
  const width = Math.hypot(vw, vh) * 0.55;
  const height = (width * brand.logo.height) / brand.logo.width;
  const hx = width / 2;
  const hy = height / 2;
  page.drawImage(brand.logo, {
    x: vw / 2 - (hx * cos - hy * sin),
    y: vh / 2 - (hx * sin + hy * cos),
    width,
    height,
    rotate: degrees((angle * 180) / Math.PI),
    opacity: 0.09,
  });
};

/** Draws the corner badge; returns its visual-space rect for the link. */
const drawBadge = (page: PDFPage, brand: Brand, vw: number, vh: number): Box => {
  // A4 is the reference size; scale the badge for posters / small slips.
  const s = Math.min(2.5, Math.max(0.75, Math.min(vw, vh) / 595));
  const lead = "Downloaded from ";
  const leadSize = 7 * s;
  const siteSize = 7.5 * s;
  const height = 17 * s;
  const padX = 7 * s;
  const iconSize = 11 * s;
  const gap = 4 * s;
  const margin = 12 * s;

  const leadWidth = brand.regular.widthOfTextAtSize(lead, leadSize);
  const siteWidth = brand.bold.widthOfTextAtSize(WATERMARK_TEXT, siteSize);
  const width = padX + iconSize + gap + leadWidth + siteWidth + padX;
  const x = vw - margin - width;
  const y = margin;

  page.drawSvgPath(pillPath(width, height), {
    x,
    y: y + height,
    color: WHITE,
    opacity: 0.92,
    borderColor: BRAND,
    borderOpacity: 0.55,
    borderWidth: 0.6 * s,
  });

  // Official site icon.
  const midY = y + height / 2;
  page.drawImage(brand.icon, {
    x: x + padX,
    y: midY - iconSize / 2,
    width: iconSize,
    height: iconSize,
  });

  const textX = x + padX + iconSize + gap;
  const baseline = midY - brand.bold.heightAtSize(siteSize, { descender: false }) / 2;
  page.drawText(lead, { x: textX, y: baseline, size: leadSize, font: brand.regular, color: MUTED });
  page.drawText(WATERMARK_TEXT, {
    x: textX + leadWidth,
    y: baseline,
    size: siteSize,
    font: brand.bold,
    color: BRAND_DARK,
  });

  return { x, y, width, height };
};

/** Adds a URI link annotation over a visual-space rect. */
const addLink = (doc: PDFDocument, page: PDFPage, matrix: Matrix, rect: Box) => {
  const corners = [
    applyMatrix(matrix, rect.x, rect.y),
    applyMatrix(matrix, rect.x + rect.width, rect.y + rect.height),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const link = doc.context.register(
    doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(SITE_URL) },
    })
  );
  page.node.addAnnot(link);
};

/**
 * Returns the watermarked PDF, or `null` when the file can't be stamped
 * (encrypted, corrupt, already stamped) — the caller then uploads it as-is,
 * so a watermark problem never blocks an admin upload.
 */
export const watermarkPdf = async (input: Uint8Array): Promise<Uint8Array | null> => {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(input, { updateMetadata: false });
  } catch (err: any) {
    console.warn(`[pdfWatermark] skipped — could not open PDF: ${err?.message || err}`);
    return null;
  }

  // getInfoDict() is public at runtime but marked private in pdf-lib's typings.
  const info: PDFDict = (doc as any).getInfoDict();
  if (info.has(MARKER_KEY)) return null;

  const brand: Brand = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    logo: await doc.embedPng(LOGO_PNG),
    icon: await doc.embedPng(ICON_PNG),
  };

  for (const page of doc.getPages()) {
    const { width, height, matrix } = visualSpace(page.getCropBox(), pageRotation(page));
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...matrix));
    drawDiagonal(page, brand, width, height);
    const badge = drawBadge(page, brand, width, height);
    page.pushOperators(popGraphicsState());
    addLink(doc, page, matrix, badge);
  }

  info.set(MARKER_KEY, PDFString.of("v1"));
  return doc.save();
};
