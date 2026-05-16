import { Schema, model, Document, Types } from "mongoose";

/**
 * Price plan for a TestSeries — one TestSeries can have many plans (e.g.
 * "10 days / ₹300", "1 Month / ₹500"). `duration` is in DAYS (mockup shows
 * "Valid until Sep 17, 2026" and "Validity 10 days"). `originalPrice` is the
 * struck-through MRP for the discount badge.
 */
export interface ITestSeriesPrice extends Document {
  testSeriesId: Types.ObjectId;
  name?: string;
  durationDays: number;
  price: number;
  originalPrice?: number;
  isDefault: boolean;
  status: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const TestSeriesPriceSchema = new Schema<ITestSeriesPrice>(
  {
    testSeriesId: { type: Schema.Types.ObjectId, ref: "TestSeries", required: true },
    name: { type: String, default: null, maxlength: 200 },
    durationDays: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
    originalPrice: { type: Number, min: 0 },
    isDefault: { type: Boolean, default: false },
    status: { type: Boolean, default: true },
  },
  { collection: "ws_test_series_prices", timestamps: true }
);

TestSeriesPriceSchema.index({ testSeriesId: 1, status: 1 });

export const TestSeriesPrice = model<ITestSeriesPrice>(
  "TestSeriesPrice",
  TestSeriesPriceSchema
);
