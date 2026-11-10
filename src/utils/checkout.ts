// Pure helpers for the PayPal redirect flow. Nothing here is trusted by the server: every id below is re-checked there (ownership, order, amount).
const ORDER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface ReturnParams { orderId: string | null; bookingId: string | null }

// PayPal sends the buyer back with the order id in `token`. Our own return link also carries the booking id.
export function parseReturnParams(search: string): ReturnParams {
  const p = new URLSearchParams(search), token = p.get('token'), booking = p.get('bookingId');
  return { orderId: token && ORDER_ID.test(token) ? token : null, bookingId: booking && UUID.test(booking) ? booking.toLowerCase() : null };
}

// Before leaving for PayPal the page remembers which booking an order belongs to (this tab only), so the return page can recover it.
const key = (orderId: string) => `careergraph:checkout:${orderId}`;
export function rememberCheckout(bookingId: string, orderId: string): void { try { sessionStorage.setItem(key(orderId), bookingId); } catch { /* private mode: the booking id in the return link is the fallback */ } }
export function recallCheckout(orderId: string): string | null { try { return sessionStorage.getItem(key(orderId)); } catch { return null; } }
export function forgetCheckout(orderId: string): void { try { sessionStorage.removeItem(key(orderId)); } catch { /* nothing to forget */ } }

export type Resolved = { ok: true; bookingId: string; orderId: string } | { ok: false; reason: 'no_order' | 'no_booking' | 'conflict' };
// The remembered booking wins; the return link's booking id is the fallback. If both exist and disagree, nothing is captured.
export function resolveCheckout(p: ReturnParams): Resolved {
  if (!p.orderId) return { ok: false, reason: 'no_order' };
  const stored = recallCheckout(p.orderId);
  if (stored && p.bookingId && stored.toLowerCase() !== p.bookingId) return { ok: false, reason: 'conflict' };
  const bookingId = stored ?? p.bookingId;
  return bookingId ? { ok: true, bookingId, orderId: p.orderId } : { ok: false, reason: 'no_booking' };
}

// Defensive check on the link the SERVER returned: only an https PayPal address is ever followed. The link itself is never built in the browser.
export function isPayPalApprovalUrl(url: unknown): url is string {
  try { const u = new URL(String(url)); return u.protocol === 'https:' && (u.hostname === 'paypal.com' || u.hostname.endsWith('.paypal.com')); } catch { return false; }
}
