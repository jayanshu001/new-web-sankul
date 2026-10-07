// Courier config: Mahavir/Tirupati tracking-page URLs and the Tirupati AWB API endpoints.
export const COURIER = {
  MAHAVIR: {
    BASE_URL:
      process.env.MAHAVIR_BASE_URL ||
      "http://shreemahavircourier.com/Frm_DocTrack.aspx",
  },
  TIRUPATI: {
    BASE_URL:
      process.env.TIRUPATI_BASE_URL ||
      "http://www.shreetirupaticourier.net/Frm_DocTrack.aspx",
    INITIAL_Number:
      Number(process.env.TIRUPATI_INITIAL_NUMBER) || 119400228001,
    // Live AWB API (Tirupati only; Mahavir is a page link). GET_TOKEN_URL embeds
    // UID/PWD per the courier's contract; these defaults are placeholders, set the env vars.
    GET_TOKEN_URL:
      process.env.TIRUPATI_GET_TOKEN_URL ||
      "http://shreetirupaticourier.net/STCS_Token.aspx?UID=__SET_IN_ENV__&PWD=__SET_IN_ENV__",
    AWB_DATA_URL:
      process.env.TIRUPATI_AWB_DATA_URL ||
      "http://shreetirupaticourier.net/STCS_Tracking.aspx",
  },
} as const;

// trackingId below TIRUPATI.INITIAL_Number routes to Mahavir, at/above to
// Tirupati. Null when no trackingId has been allocated yet.
export function buildTrackingUrl(
  trackingId?: number | string | null,
  nowMs: number = Date.now()
): string | null {
  if (trackingId === null || trackingId === undefined || trackingId === "")
    return null;
  const idNum = Number(trackingId);
  if (!Number.isFinite(idNum)) return null;

  const tmp = Math.floor(nowMs / 1000);
  const base =
    idNum < COURIER.TIRUPATI.INITIAL_Number
      ? COURIER.MAHAVIR.BASE_URL
      : COURIER.TIRUPATI.BASE_URL;
  return `${base}?Tmp=${tmp}&docno=${idNum}`;
}
