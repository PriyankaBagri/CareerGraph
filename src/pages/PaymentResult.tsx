import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { formatPrice, mentorTitle } from '../services/mentorship';
import { cancelCheckout, completeCheckout, type CheckoutOutcome } from '../services/checkout';
import { parseReturnParams } from '../utils/checkout';

type State = { kind: 'working' } | CheckoutOutcome;

// PayPal sends the buyer here after approval. Approval is NOT payment: the server captures the order and verifies it with PayPal, and
// only a confirmed result is shown as success. Refreshing or revisiting this page asks the server again; repeats are idempotent there.
export function PaymentReturn() {
  const { search } = useLocation();
  const params = useMemo(() => parseReturnParams(search), [search]);
  const [state, setState] = useState<State>({ kind: 'working' });
  const ranFor = useRef<string | null>(null);
  const run = useCallback(async () => { setState({ kind: 'working' }); setState(await completeCheckout(params)); }, [params]);
  useEffect(() => { document.title = 'Payment · CareerGraph'; if (ranFor.current !== search) { ranFor.current = search; void run(); } }, [search, run]);

  return (
    <div className="animate-rise mx-auto max-w-xl space-y-4">
      <h1 className="text-3xl font-semibold">Your payment</h1>
      <section className="card-dark space-y-3" aria-live="polite">
        {state.kind === 'working' && <p role="status">Confirming your payment… please keep this page open.</p>}
        {state.kind === 'confirmed' && (
          <>
            <p role="status" className="text-lg font-semibold text-ok">Booking confirmed</p>
            <p>{state.booking.session.title} with {mentorTitle(state.booking.mentor)}{state.booking.career ? ` (for ${state.booking.career.name})` : ''} is paid ({formatPrice(state.payment.amount, state.payment.currency)}).</p>
            {state.payment.captureId && <p className="break-all text-xs text-mute">PayPal reference: {state.payment.captureId}</p>}
            {state.booking.mentor.isDemo && <p className="text-xs text-mute">Sample session paid with Sandbox test money. No real mentor is involved.</p>}
          </>
        )}
        {state.kind === 'waiting' && <><p role="status" className="font-semibold">Not confirmed yet</p><p className="text-sm text-mute">{state.message}</p><button className="btn" onClick={() => void run()}>Check again</button></>}
        {state.kind === 'failed' && <><p role="alert" className="font-semibold text-bad">Payment not confirmed</p><p className="text-sm text-mute">{state.message}</p>{state.canRetry && <button className="btn" onClick={() => void run()}>Try again</button>}</>}
        {state.kind === 'unmatched' && <p role="alert">We couldn't match this payment to a booking, so nothing was confirmed. Go to your bookings and try again.</p>}
        {state.kind === 'sign_in' && <p role="alert">Your session has ended. <Link to="/login" className="underline">Sign in</Link>, then open this page again.</p>}
        <Link to="/bookings" className="btn-quiet">{state.kind === 'confirmed' ? 'View my bookings' : 'Back to bookings'}</Link>
      </section>
    </div>
  );
}

export function PaymentCancel() {
  const { search } = useLocation();
  useEffect(() => { document.title = 'Payment cancelled · CareerGraph'; cancelCheckout(parseReturnParams(search)); }, [search]);
  return (
    <div className="animate-rise mx-auto max-w-xl space-y-4">
      <h1 className="text-3xl font-semibold">Payment cancelled</h1>
      <section className="card-dark space-y-3"><p role="status">You cancelled the payment. Your booking is still unpaid, and you can pay any time.</p><Link to="/bookings" className="btn">Back to bookings</Link></section>
    </div>
  );
}
