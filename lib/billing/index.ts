// ─── Provider-agnostic billing adapter ───────────────────────────────────────
// To switch to Stripe: replace the paystack import with a stripe.ts
// that exports the same InitializeParams, InitializeResult, and VerifyResult types
// and the same function signatures.

export {
  initializeTransaction,
  verifyTransaction,
  verifyWebhookSignature,
} from "./paystack";

export type { InitializeParams, InitializeResult, VerifyResult } from "./paystack";

// ─── Plan to amount mapping (in smallest currency unit) ──────────────────────
// To support multiple currencies, add a getCurrencyAmount(planKey, currency) helper.

export const PLAN_AMOUNTS_CENTS: Record<string, number> = {
  starter: 900,  // $9.00
  pro: 2900,     // $29.00
};
