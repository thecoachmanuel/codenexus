// ─── Paystack API wrapper ─────────────────────────────────────────────────────
// Stripe-ready: to swap to Stripe, create lib/billing/stripe.ts with the same
// interface and update lib/billing/index.ts to import from there instead.

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!;
const BASE_URL = "https://api.paystack.co";

function paystackFetch(path: string, options?: RequestInit) {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
}

// ─── Initialize a one-time payment transaction ────────────────────────────────

export interface InitializeParams {
  email: string;
  amountKobo: number; // amount in kobo (NGN) or lowest currency unit
  reference: string;
  metadata?: Record<string, unknown>;
  callbackUrl: string;
}

export interface InitializeResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

export async function initializeTransaction(
  params: InitializeParams
): Promise<InitializeResult> {
  const res = await paystackFetch("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: params.email,
      amount: params.amountKobo,
      reference: params.reference,
      metadata: params.metadata,
      callback_url: params.callbackUrl,
    }),
  });

  const data = await res.json();
  if (!data.status) throw new Error(data.message ?? "Paystack initialization failed");

  return {
    authorizationUrl: data.data.authorization_url,
    accessCode: data.data.access_code,
    reference: data.data.reference,
  };
}

// ─── Verify a transaction by reference ───────────────────────────────────────

export interface VerifyResult {
  status: string; // "success" | "failed" | "abandoned"
  amount: number; // in kobo
  reference: string;
  metadata: Record<string, unknown>;
  customer: { email: string };
}

export async function verifyTransaction(
  reference: string
): Promise<VerifyResult> {
  const res = await paystackFetch(`/transaction/verify/${reference}`);
  const data = await res.json();
  if (!data.status) throw new Error(data.message ?? "Verification failed");

  return {
    status: data.data.status,
    amount: data.data.amount,
    reference: data.data.reference,
    metadata: data.data.metadata ?? {},
    customer: { email: data.data.customer.email },
  };
}

// ─── Verify webhook signature ─────────────────────────────────────────────────

import crypto from "crypto";

export function verifyWebhookSignature(
  rawBody: string,
  signature: string
): boolean {
  const hash = crypto
    .createHmac("sha512", PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest("hex");
  return hash === signature;
}
