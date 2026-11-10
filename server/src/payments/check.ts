import { loadConfig } from '../config';
import { diagnosePayPal } from './diagnose';

// npm run paypal:check : asks PayPal Sandbox for a token and creates one unpaid test order, then says which step failed.
async function main(): Promise<number> {
  const config = loadConfig(process.env);
  const steps = await diagnosePayPal(config.paypal, config.clientOrigins[0] ?? 'http://localhost:5173');
  for (const s of steps) console.log(`${s.ok ? 'OK  ' : 'FAIL'} ${s.name}: ${s.detail}`);
  return steps.every((s) => s.ok) ? 0 : 1;
}
main().then((code) => process.exit(code), () => { console.log('FAIL paypal:check could not run (check server/.env)'); process.exit(1); });
