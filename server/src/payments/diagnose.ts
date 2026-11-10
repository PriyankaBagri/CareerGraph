import { paypalReady, type PayPalConfig } from '../config';
import { PayPalClient, PayPalError, type PayPalFetch } from './paypal';

// Proves, step by step, whether this server can talk to PayPal Sandbox. It prints only step names, HTTP statuses and PayPal's short issue codes:
// never the keys, the access token or a response body.
export interface Step { name: string; ok: boolean; detail: string }
const describe = (e: unknown): string => e instanceof PayPalError ? `${e.category}${e.upstreamStatus ? ` (HTTP ${e.upstreamStatus})` : ''}${e.issue ? ` ${e.issue}` : ''}` : 'unexpected error';

export async function diagnosePayPal(cfg: PayPalConfig, returnBase: string, opts: { createOrder: boolean; fetchImpl?: PayPalFetch } = { createOrder: true }): Promise<Step[]> {
  const steps: Step[] = [];
  if (cfg.problem) return [{ name: 'PayPal settings', ok: false, detail: cfg.problem }];
  if (!paypalReady(cfg)) return [{ name: 'PayPal settings', ok: false, detail: 'PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are not both set' }];
  steps.push({ name: 'PayPal settings', ok: true, detail: `mode=${cfg.mode}, api=${cfg.baseUrl}` });
  let base: URL | null = null;
  try { base = new URL(returnBase); } catch { /* reported below */ }
  steps.push(base && /^https?:$/.test(base.protocol) ? { name: 'Return address', ok: true, detail: `${base.origin}/bookings/payment/return` } : { name: 'Return address', ok: false, detail: 'the first CLIENT_ORIGIN is not a valid http(s) address' });
  const client = new PayPalClient(cfg, opts.fetchImpl ?? ((url, init) => fetch(url, init)));
  try { await client.checkToken(); steps.push({ name: 'Sign in to PayPal with your Sandbox keys', ok: true, detail: 'accepted' }); }
  catch (e) { steps.push({ name: 'Sign in to PayPal with your Sandbox keys', ok: false, detail: describe(e) }); return steps; }
  if (!opts.createOrder) return steps;
  try {
    await client.createOrder({ bookingId: '00000000-0000-4000-8000-000000000000', amount: '1.00', currency: 'USD', requestId: `cg-check-${Date.now()}`, returnUrl: `${returnBase}/bookings/payment/return`, cancelUrl: `${returnBase}/bookings/payment/cancel` });
    steps.push({ name: 'Create a test order (USD 1.00, never paid)', ok: true, detail: 'accepted' });
  } catch (e) { steps.push({ name: 'Create a test order (USD 1.00, never paid)', ok: false, detail: describe(e) }); }
  return steps;
}
