// Rank predictor storage: private Spaces keys, upload and signed URLs for rank PDFs.
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { UPLOAD_FOLDERS } from "../config/uploadFolders";
import { DO_BUCKET, s3Config } from "../middlewares/upload";
import logger from "./logger";

const DEFAULT_URL_TTL_SECONDS = 15 * 60;
const PDF_CONTENT_TYPE = "application/pdf";
const HTML_CONTENT_TYPE = "text/html; charset=utf-8";
const PRIVATE_ACL = "private";
const ORGANISED_ROOT = UPLOAD_FOLDERS.rankSheets;
const UNKNOWN_FOLDER = "unknown";
const DELETE_BATCH_SIZE = 1000;

export const RANK_SHEET_URL_TTL_SECONDS =
  Number(process.env.RANK_SHEET_URL_TTL_SECONDS) || DEFAULT_URL_TTL_SECONDS;

const client = s3Config as any;

export const rankSheetKey = (customerId: number, submissionId: string): string =>
  `customer/rank-sheets/${customerId}/${submissionId}.pdf`;

/**
 * The Digialm page a sheet was printed from, filed beside its PDF. Only a link or
 * an HTML upload has one; it is what the reader reads, the PDF is what people view.
 */
export const rankSheetHtmlKey = (pdfKey: string): string => pdfKey.replace(/\.pdf$/i, "") + ".html";

export const answerKeyPdfKey = (examId: string, version: number, series: string | null): string =>
  `admin/rank-predictor/answer-keys/${examId}/v${version}${series ? `-${series}` : ""}.pdf`;

/** One path segment: lower-case, no slashes, nothing a browser or a shell trips on. */
const folderOf = (value: string | null | undefined): string =>
  (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || UNKNOWN_FOLDER;

/** "2026-09-14T10:00" -> "2026-09-14_1000". */
const shiftFolderOf = (shiftKey: string | null): string =>
  folderOf(shiftKey?.replace("T", "_").replace(":", ""));

export interface OrganisedSheetParts {
  examCode: string;
  shiftKey: string | null;
  casteCategory: string | null;
  gender: string | null;
  rollNumber: string | null;
  submissionId: string;
}

/** Every sheet in one exam's organised folder tree. */
export const organisedExamPrefix = (examCode: string): string =>
  `${ORGANISED_ROOT}/${folderOf(examCode)}/`;

/**
 * Where a read sheet is filed for browsing: exam / shift / category / gender.
 * A copy of the source sheet, never the copy the service reads from; anything
 * not known yet (an OMR sheet prints no slot, a profile left unanswered) is
 * filed under "unknown".
 */
export const organisedRankSheetKey = (parts: OrganisedSheetParts): string => {
  const roll = parts.rollNumber ? `${folderOf(parts.rollNumber)}_` : "";
  return (
    organisedExamPrefix(parts.examCode) +
    `${shiftFolderOf(parts.shiftKey)}/${folderOf(parts.casteCategory)}/${folderOf(parts.gender)}/` +
    `${roll}${parts.submissionId}.pdf`
  );
};

export const putRankPdf = async (
  key: string,
  body: Buffer,
  contentType: string = PDF_CONTENT_TYPE
): Promise<string> => {
  await client.send(
    new PutObjectCommand({
      Bucket: DO_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentLength: body.length,
      ACL: PRIVATE_ACL,
    })
  );

  return key;
};

/** The stored sheet's bytes — what the background reader works from. */
export const getRankPdf = async (key: string): Promise<Buffer> => {
  const response = await client.send(new GetObjectCommand({ Bucket: DO_BUCKET, Key: key }));
  return Buffer.from(await response.Body.transformToByteArray());
};

export const putRankHtml = (pdfKey: string, body: Buffer): Promise<string> =>
  putRankPdf(rankSheetHtmlKey(pdfKey), body, HTML_CONTENT_TYPE);

/**
 * The page a sheet was printed from, or null when it came in as a PDF. Asked for
 * every sheet, so it never fails one: on anything but a plain "not found" it logs
 * and answers null, and the sheet is read from its PDF — the same sheet printed,
 * which reads to the same answers.
 */
export const findRankHtml = async (pdfKey: string): Promise<Buffer | null> => {
  try {
    return await getRankPdf(rankSheetHtmlKey(pdfKey));
  } catch (error: any) {
    const status = error?.$metadata?.httpStatusCode;
    if (status !== 404 && error?.name !== "NotFound" && error?.name !== "NoSuchKey") {
      logger.warn("Rank sheet page lookup failed, reading the PDF", {
        pdfKey,
        status,
        error: error?.name ?? String(error),
      });
    }
    return null;
  }
};

export const getSignedRankPdfUrl = (
  key: string,
  expiresIn: number = RANK_SHEET_URL_TTL_SECONDS
): Promise<string> =>
  getSignedUrl(client, new GetObjectCommand({ Bucket: DO_BUCKET, Key: key }), { expiresIn });

/** Server-side copy inside the bucket; the PDF never passes through this process. */
export const copyRankPdf = async (sourceKey: string, targetKey: string): Promise<void> => {
  await client.send(
    new CopyObjectCommand({
      Bucket: DO_BUCKET,
      CopySource: encodeURI(`${DO_BUCKET}/${sourceKey}`),
      Key: targetKey,
      ContentType: PDF_CONTENT_TYPE,
      MetadataDirective: "REPLACE",
      ACL: PRIVATE_ACL,
    })
  );
};

/** Every key under a prefix, paged through. */
export const listRankPdfKeys = async (prefix: string): Promise<string[]> => {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: DO_BUCKET, Prefix: prefix, ContinuationToken: token })
    );
    for (const item of page.Contents ?? []) if (item.Key) keys.push(item.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
};

export const deleteRankPdfKeys = async (keys: string[]): Promise<void> => {
  for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
    await client.send(
      new DeleteObjectsCommand({
        Bucket: DO_BUCKET,
        Delete: { Objects: keys.slice(i, i + DELETE_BATCH_SIZE).map((Key) => ({ Key })), Quiet: true },
      })
    );
  }
};

// Best-effort: delete errors are swallowed.
export const deleteRankPdf = async (key: string): Promise<void> => {
  try {
    await client.send(new DeleteObjectCommand({ Bucket: DO_BUCKET, Key: key }));
  } catch {
    return;
  }
};

/** A stored sheet together with the page it was printed from, if it had one. */
export const deleteRankSheet = async (pdfKey: string): Promise<void> => {
  await Promise.all([deleteRankPdf(pdfKey), deleteRankPdf(rankSheetHtmlKey(pdfKey))]);
};
