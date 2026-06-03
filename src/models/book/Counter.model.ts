import { Schema, model } from "mongoose";

// Atomic sequence allocator. Reproduces the old backend's behaviour where the
// courier "AWB number" is just an internal sequential counter handed out by the
// database (see book-order-courier-tracking.md, Point 1) — no real shipment is
// booked. Each named counter owns its own monotonically-increasing `seq`.
// `_id` is a string name (not an ObjectId), so we don't extend Document.
export interface ICounter {
  _id: string;
  seq: number;
}

const CounterSchema = new Schema<ICounter>(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { collection: "ws_counters", versionKey: false }
);

export const Counter = model<ICounter>("Counter", CounterSchema);

// The book-tracking counter starts one below COURIER.TIRUPATI.INITIAL_Number so
// the FIRST allocated id equals INITIAL_Number (119400228001) — i.e. every new
// order lands in the Tirupati range, matching the threshold routing in Point 3.
export const BOOK_TRACKING_COUNTER = "book_tracking_id";

// Atomically allocate and return the next sequential tracking id. `seed` is the
// value the very first allocation should return; used to upsert the counter
// document on first call so it starts in the Tirupati range.
export async function nextTrackingId(seed: number): Promise<number> {
  const doc = await Counter.findByIdAndUpdate(
    BOOK_TRACKING_COUNTER,
    [
      {
        $set: {
          // On first upsert `seq` is missing → start at seed. Afterwards inc by 1.
          seq: {
            $cond: [
              { $ifNull: ["$seq", false] },
              { $add: ["$seq", 1] },
              seed,
            ],
          },
        },
      },
    ],
    { new: true, upsert: true }
  );
  return doc!.seq;
}
