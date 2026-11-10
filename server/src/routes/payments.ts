import * as c from '../controllers/payments';
import type { Route } from '../http/types';

export const paymentRoutes: Route[] = [
  { method: 'POST', path: '/api/payments/create-order', auth: true, handler: c.createOrder },
  { method: 'POST', path: '/api/payments/capture', auth: true, handler: c.capture },
];
