import { paypalReady, type PayPalConfig } from '../config';

// Minimal server-side PayPal REST client (Sandbox only) using native fetch. It never logs or returns credentials, tokens or response bodies:
// every failure is reduced to a category (plus the HTTP status and, for rejections, PayPal's own short issue code such as ORDER_NOT_APPROVED).
export type PayPalFailure = 'timeout' | 'network' | 'rejected' | 'invalid_response';
// `stage` says which call failed: 'token' (sign-in with the Sandbox keys) or 'api' (creating, capturing or reading an order).
export class PayPalError extends Error { stage: 'token' | 'api' = 'api'; constructor(public readonly category: PayPalFailure, public readonly upstreamStatus?: number, public readonly issue?: string) { super(category); } }
export type PayPalFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export const ORDER_ID = /^[A-Za-z0-9_-]{1,64}$/; // PayPal order ids are short alphanumeric strings
export interface PayPalOrderResult { orderId: string; status: string; referenceId: string | null; capture: { id: string; status: string; value: string; currency: string } | null }
export interface PayPalApi {
  createOrder(input: { bookingId: string; amount: string; currency: string; requestId: string; returnUrl: string; cancelUrl: string }): Promise<{ orderId: string }>;
  captureOrder(orderId: string, requestId: string): Promise<PayPalOrderResult>;
  getOrder(orderId: string): Promise<PayPalOrderResult>;
}

// Money is compared as whole cents from decimal text, never as floating point.
export const toCents = (v: unknown): number | null => { const m = typeof v === 'string' ? /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(v) : null; return m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')) : null; };
export const sameMoney = (a: string, b: string): boolean => { const x = toCents(a), y = toCents(b); return x !== null && x === y; };
// The browser is sent to PayPal's Sandbox checkout page for this order. Built from the order id only; never taken from a PayPal response.
export const approvalUrl = (orderId: string): string => `https://www.sandbox.paypal.com/checkoutnow?token=${encodeURIComponent(orderId)}`;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown): string | null => (typeof x === 'string' && x ? x : null);

function parseOrder(data: unknown): PayPalOrderResult {
  if (!isObj(data)) throw new PayPalError('invalid_response');
  const orderId = str(data.id), status = str(data.status);
  if (!orderId || !ORDER_ID.test(orderId) || !status) throw new PayPalError('invalid_response');
  const unit = Array.isArray(data.purchase_units) && isObj(data.purchase_units[0]) ? data.purchase_units[0] : null;
  const payments = unit && isObj(unit.payments) ? unit.payments : null;
  const cap = payments && Array.isArray(payments.captures) && isObj(payments.captures[0]) ? payments.captures[0] : null;
  const amount = cap && isObj(cap.amount) ? cap.amount : null;
  const capture = cap && amount && str(cap.id) && str(cap.status) && str(amount.value) && str(amount.currency_code)
    ? { id: str(cap.id) as string, status: str(cap.status) as string, value: str(amount.value) as string, currency: str(amount.currency_code) as string } : null;
  return { orderId, status, referenceId: unit ? str(unit.reference_id) : null, capture };
}

export class PayPalClient implements PayPalApi {
  private token: { value: string; expiresAt: number } | null = null;
  constructor(private readonly cfg: PayPalConfig, private readonly fetchImpl: PayPalFetch, private readonly now: () => number = Date.now) {}

  private async call(url: string, method: string, headers: Record<string, string>, body?: string): Promise<unknown> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.cfg.timeoutMs);
    try {
      const res = await this.fetchImpl(url, { method, headers, body, signal: ctl.signal });
      let data: unknown = null;
      try { data = await res.json(); } catch { data = null; }
      if (!res.ok) {
        const issue = isObj(data) && Array.isArray(data.details) && isObj(data.details[0]) ? str(data.details[0].issue) : null;
        throw new PayPalError('rejected', res.status, issue && /^[A-Z_]{3,60}$/.test(issue) ? issue : undefined);
      }
      if (data === null) throw new PayPalError('invalid_response', res.status);
      return data;
    } catch (e) {
      if (e instanceof PayPalError) throw e;
      throw new PayPalError(ctl.signal.aborted ? 'timeout' : 'network');
    } finally { clearTimeout(timer); }
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now()) return this.token.value;
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64');
    let data: unknown;
    try { data = await this.call(`${this.cfg.baseUrl}/v1/oauth2/token`, 'POST', { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, 'grant_type=client_credentials'); }
    catch (e) { if (e instanceof PayPalError) e.stage = 'token'; throw e; }
    const value = isObj(data) ? str(data.access_token) : null, ttl = isObj(data) && typeof data.expires_in === 'number' ? data.expires_in : 0;
    if (!value || ttl <= 0) { const bad = new PayPalError('invalid_response'); bad.stage = 'token'; throw bad; }
    this.token = { value, expiresAt: this.now() + Math.max(ttl - 60, 0) * 1000 }; // refresh a minute early
    return value;
  }
  private async api(path: string, method: string, requestId?: string, body?: unknown): Promise<unknown> {
    const headers = { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(requestId ? { 'PayPal-Request-Id': requestId } : {}) };
    try { return await this.call(`${this.cfg.baseUrl}${path}`, method, headers, body === undefined ? undefined : JSON.stringify(body)); }
    catch (e) { if (e instanceof PayPalError && e.upstreamStatus === 401) this.token = null; throw e; } // an expired token is dropped so the next call gets a fresh one
  }

  async createOrder({ bookingId, amount, currency, requestId, returnUrl, cancelUrl }: { bookingId: string; amount: string; currency: string; requestId: string; returnUrl: string; cancelUrl: string }) {
    const data = await this.api('/v2/checkout/orders', 'POST', requestId, {
      intent: 'CAPTURE',
      purchase_units: [{ reference_id: bookingId, custom_id: bookingId, description: 'CareerGraph mentor session', amount: { currency_code: currency, value: amount } }],
      // Where PayPal sends the buyer after approving or cancelling. PayPal appends the order id (as `token`) to both URLs.
      payment_source: { paypal: { experience_context: { return_url: returnUrl, cancel_url: cancelUrl, user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING', brand_name: 'CareerGraph' } } },
    });
    return { orderId: parseOrder(data).orderId };
  }
  // Used by the startup check and `npm run paypal:check`: succeeds only if PayPal accepts the Sandbox keys.
  async checkToken(): Promise<void> { this.token = null; await this.accessToken(); }
  async captureOrder(orderId: string, requestId: string) { return parseOrder(await this.api(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, 'POST', requestId, {})); }
  async getOrder(orderId: string) { return parseOrder(await this.api(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, 'GET')); }
}

export function createPayPalClient(cfg: PayPalConfig, fetchImpl: PayPalFetch = (url, init) => fetch(url, init), now?: () => number): PayPalApi | null {
  return paypalReady(cfg) ? new PayPalClient(cfg, fetchImpl, now) : null;
}
