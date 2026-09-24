import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DO_BUCKET, s3Config } from "../middlewares/upload";

const DEFAULT_URL_TTL_SECONDS = 15 * 60;
const PDF_CONTENT_TYPE = "application/pdf";
const PRIVATE_ACL = "private";

export const RANK_SHEET_URL_TTL_SECONDS =
  Number(process.env.RANK_SHEET_URL_TTL_SECONDS) || DEFAULT_URL_TTL_SECONDS;

const client = s3Config as any;

export const rankSheetKey = (customerId: number, submissionId: string): string =>
  `customer/rank-sheets/${customerId}/${submissionId}.pdf`;

export const answerKeyPdfKey = (examId: string, version: number, series: string | null): string =>
  `admin/rank-predictor/answer-keys/${examId}/v${version}${series ? `-${series}` : ""}.pdf`;

export const putRankPdf = async (key: string, body: Buffer): Promise<string> => {
  await client.send(
    new PutObjectCommand({
      Bucket: DO_BUCKET,
      Key: key,
      Body: body,
      ContentType: PDF_CONTENT_TYPE,
      ContentLength: body.length,
      ACL: PRIVATE_ACL,
    })
  );

  return key;
};

export const getSignedRankPdfUrl = (
  key: string,
  expiresIn: number = RANK_SHEET_URL_TTL_SECONDS
): Promise<string> =>
  getSignedUrl(client, new GetObjectCommand({ Bucket: DO_BUCKET, Key: key }), { expiresIn });

export const deleteRankPdf = async (key: string): Promise<void> => {
  try {
    await client.send(new DeleteObjectCommand({ Bucket: DO_BUCKET, Key: key }));
  } catch {
    return;
  }
};
