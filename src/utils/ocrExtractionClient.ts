import { OCR_SERVICE, isOcrServiceConfigured } from "../config/ocrService";
import { callOutbound } from "../libs/outbound";
import {
  RANK_ERROR,
  type AnswerKeyMap,
  type ExtractionKind,
} from "../modules/rank-predictor/rank-predictor.types";

export interface OcrExtractionResult {
  kind: ExtractionKind;
  roll_number: string | null;
  total_questions: number;
  answers: Record<string, number | null>;
  low_confidence_questions: number[];
  embedded_key_for_reference_only: AnswerKeyMap | null;
}

export class OcrExtractionError extends Error {
  constructor(
    public code: string,
    message?: string
  ) {
    super(message ?? code);
    this.name = "OcrExtractionError";
  }
}

const EXTRACT_PATH = "/extract";
const INTERNAL_TOKEN_HEADER = "X-Internal-Token";
const PDF_CONTENT_TYPE = "application/pdf";
const OUTBOUND_LABEL = "ocr:extract";
const OUTBOUND_ATTEMPTS = 2;
const STRUCTURED_ERROR_STATUSES = new Set([413, 415, 422]);

const toFormData = (fileBuffer: Buffer, fileName: string): FormData => {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(fileBuffer)], { type: PDF_CONTENT_TYPE }),
    fileName
  );
  return form;
};

export const extractResponseSheet = async (
  fileBuffer: Buffer,
  fileName: string
): Promise<OcrExtractionResult> => {
  if (!isOcrServiceConfigured()) {
    throw new OcrExtractionError(
      RANK_ERROR.EXTRACTION_UNCONFIGURED,
      "OCR service is not configured"
    );
  }

  return callOutbound(
    async () => {
      const response = await fetch(`${OCR_SERVICE.BASE_URL}${EXTRACT_PATH}`, {
        method: "POST",
        body: toFormData(fileBuffer, fileName),
        headers: { [INTERNAL_TOKEN_HEADER]: OCR_SERVICE.INTERNAL_TOKEN },
      });

      if (STRUCTURED_ERROR_STATUSES.has(response.status)) {
        const body = (await response
          .json()
          .catch(() => ({ error: RANK_ERROR.UNKNOWN_EXTRACTION_ERROR }))) as { error?: string };
        throw new OcrExtractionError(body.error || RANK_ERROR.UNKNOWN_EXTRACTION_ERROR);
      }

      if (!response.ok) {
        throw new Error(`OCR service returned HTTP ${response.status}`);
      }

      return (await response.json()) as OcrExtractionResult;
    },
    {
      label: OUTBOUND_LABEL,
      timeoutMs: OCR_SERVICE.TIMEOUT_MS,
      attempts: OUTBOUND_ATTEMPTS,
      shouldRetry: (error: unknown) => !(error instanceof OcrExtractionError),
    }
  );
};
