import type { BookingStatus } from '../../services/mentorship';

export function DemoBadge() {
  return <span className="rounded-full border border-warn px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warn" title="A sample profile, not a real or verified professional">Sample</span>;
}
export function DemoNotice() {
  return <p role="note" className="rounded-xl border border-warn/60 px-4 py-3 text-sm text-mute"><strong className="text-warn">Sample profiles.</strong> Not real or verified professionals, and no real appointment times. Payments use PayPal Sandbox (test money).</p>;
}
const STATUS: Record<BookingStatus, { label: string; cls: string }> = {
  pending_payment: { label: 'Payment pending', cls: 'border-warn text-warn' },
  confirmed: { label: 'Confirmed', cls: 'border-ok text-ok' },
  cancelled: { label: 'Cancelled', cls: 'border-line text-mute' },
};
export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const s = STATUS[status];
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${s.cls}`}>{s.label}</span>;
}
