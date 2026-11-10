import type { PayPalFetch } from '../src/payments/paypal';

export const SECRET = 'secret-SECRET-VALUE', TOKEN = 'tok-SECRET';
export type Mode = 'ok' | 'not_approved' | 'declined_rejection' | 'declined_capture' | 'pending' | 'amount' | 'currency' | 'reference' | 'already' | 'hang' | 'network' | 'server_error';

// A fake of PayPal's HTTP API, shared by the backend and frontend payment tests. It records every call, honours PayPal-Request-Id idempotency, and answers capture according to `mode`.
export class FakePayPal {
  calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  mode: Mode = 'ok'; failCreate: 'reject' | 'hang' | 'invalid' | 'network' | null = null; authFail = false; private seq = 0; private byRequest = new Map<string, string>(); orders = new Map<string, { ref: string; value: string; currency: string }>();
  count = (re: RegExp) => this.calls.filter((c) => re.test(c.method + ' ' + c.url)).length;
  private captured = (id: string, o: { ref: string; value: string; currency: string }, over: { status?: string; value?: string; currency?: string; ref?: string } = {}) => ({ id, status: 'COMPLETED', purchase_units: [{ reference_id: over.ref ?? o.ref, payments: { captures: [{ id: `CAP-${id}`, status: over.status ?? 'COMPLETED', amount: { currency_code: over.currency ?? o.currency, value: over.value ?? o.value } }] } }] });
  private r = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
  fetch: PayPalFetch = async (url, init) => {
    this.calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    if (url.endsWith('/v1/oauth2/token') && this.authFail) return this.r(401, { error: 'invalid_client', error_description: `${SECRET}` });
    if (url.endsWith('/v1/oauth2/token')) return this.r(200, { access_token: TOKEN, expires_in: 3600 });
    const hang = () => new Promise<never>((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
    if (init.method === 'POST' && url.endsWith('/v2/checkout/orders')) {
      if (this.failCreate === 'hang') return hang();
      if (this.failCreate === 'network') throw new Error('ENOTFOUND');
      if (this.failCreate === 'invalid') return this.r(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INVALID_PARAMETER_VALUE' }] });
      if (this.failCreate === 'reject') return this.r(500, { name: 'INTERNAL_SERVER_ERROR', message: `${SECRET} ${TOKEN}`, details: [{ issue: 'INTERNAL_ERROR' }] });
      const rid = init.headers['PayPal-Request-Id']; let id = this.byRequest.get(rid);
      if (!id) { id = `ORDER${++this.seq}`; this.byRequest.set(rid, id); const u = JSON.parse(init.body ?? '{}').purchase_units[0]; this.orders.set(id, { ref: u.reference_id, value: u.amount.value, currency: u.amount.currency_code }); }
      return this.r(201, { id, status: 'CREATED', purchase_units: [{ reference_id: this.orders.get(id)?.ref }] });
    }
    const id = /orders\/([^/]+)/.exec(url)?.[1] ?? '', o = this.orders.get(id);
    if (!o) return this.r(404, { name: 'RESOURCE_NOT_FOUND', details: [{ issue: 'INVALID_RESOURCE_ID' }] });
    if (init.method === 'GET') return this.r(200, this.captured(id, o));
    switch (this.mode) {
      case 'ok': return this.r(201, this.captured(id, o));
      case 'not_approved': return this.r(422, { details: [{ issue: 'ORDER_NOT_APPROVED' }] });
      case 'declined_rejection': return this.r(422, { details: [{ issue: 'INSTRUMENT_DECLINED' }] });
      case 'declined_capture': return this.r(201, this.captured(id, o, { status: 'DECLINED' }));
      case 'pending': return this.r(201, this.captured(id, o, { status: 'PENDING' }));
      case 'amount': return this.r(201, this.captured(id, o, { value: '1.00' }));
      case 'currency': return this.r(201, this.captured(id, o, { currency: 'EUR' }));
      case 'reference': return this.r(201, this.captured(id, o, { ref: '11111111-1111-4111-8111-111111111111' }));
      case 'already': return this.r(422, { details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] });
      case 'hang': return hang();
      case 'network': throw new Error('ECONNRESET');
      case 'server_error': return this.r(500, { details: [{ issue: 'INTERNAL_ERROR' }] });
    }
  };
}
