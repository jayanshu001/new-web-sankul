// Values sourced from websankul-api-staging constants.js. Override via env
// if a deployment needs to point to a different courier URL / threshold.
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
    // Live AWB API (Tirupati only — Mahavir has no API, it's a page link only).
    // Credentials live in env; the GET_TOKEN_URL embeds UID/PWD as query params
    // per the courier's contract. Set TIRUPATI_GET_TOKEN_URL / TIRUPATI_AWB_DATA_URL
    // in .env — these defaults are non-functional placeholders.
    GET_TOKEN_URL:
      process.env.TIRUPATI_GET_TOKEN_URL ||
      "http://shreetirupaticourier.net/STCS_Token.aspx?UID=__SET_IN_ENV__&PWD=__SET_IN_ENV__",
    AWB_DATA_URL:
      process.env.TIRUPATI_AWB_DATA_URL ||
      "http://shreetirupaticourier.net/STCS_Tracking.aspx",
  },
} as const;

// Centralised carrier-routing + URL builder (Point 3). The carrier is chosen by
// comparing the numeric trackingId against TIRUPATI.INITIAL_Number — below the
// threshold routes to Mahavir, at/above routes to Tirupati. Both carriers share
// the `?Tmp={unixSeconds}&docno={trackingId}` query shape. Returns null when no
// trackingId has been allocated yet.
//
// This replaces the if/else block that was duplicated across book/course/etc.
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
