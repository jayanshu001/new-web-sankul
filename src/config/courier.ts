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
  },
} as const;
