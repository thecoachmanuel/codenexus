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

// ─── Plan to amount mapping (in kobo for NGN) ─────────────────────────────────
// To support multiple currencies, add a getCurrencyAmount(planKey, currency) helper.

export const PLAN_AMOUNTS_KOBO: Record<string, number> = {
  starter: 9 * 100 * 100,  // $9 → 900 kobo per cent (adjust for NGN rate)
  pro: 29 * 100 * 100,      // $29
};

// When using Stripe, amounts would be in cents:
// export const PLAN_AMOUNTS_CENTS: Record<string, number> = {
//   starter: 900,   // $9.00
//   pro: 2900,      // $29.00
// };
