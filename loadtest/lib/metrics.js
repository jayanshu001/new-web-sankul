// Custom metrics (§5). Trend = per-journey latency, Rate = business-level success.
import { Trend, Rate } from 'k6/metrics';

export const journeyDuration = new Trend('journey_duration', true);
export const envelopeOk = new Rate('envelope_ok');
