export class AppError extends Error {
  public readonly expose: boolean; // whether message/details may be shown to the client
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly details?: unknown, expose?: boolean) { super(message); this.expose = expose ?? status < 500; }
}
export const badRequest = (message: string, details?: unknown) => new AppError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Authentication required.', code = 'unauthorized') => new AppError(401, code, message);
export const notFound = (message = 'Not found.', code = 'not_found') => new AppError(404, code, message);
export const methodNotAllowed = (allow: string[]) => new AppError(405, 'method_not_allowed', 'Method not allowed.', { allow });
export const conflict = (message: string) => new AppError(409, 'conflict', message);
export const payloadTooLarge = () => new AppError(413, 'payload_too_large', 'The request body is too large.');
export const authNotConfigured = () => new AppError(503, 'auth_not_configured', 'Authentication is not configured on this server.', undefined, true);
export const tooManyRequests = (retryAfterSeconds: number) => new AppError(429, 'rate_limited', 'Too many requests. Please wait a moment and try again.', { retryAfterSeconds });
// A Postgres "undefined_table" error means a migration has not been run on this database. The fix is a command, so say it.
export const databaseNotMigrated = () => new AppError(503, 'database_not_migrated', 'The database is missing a table. In the server folder run "npm run db:migrate", then restart the server.', undefined, true);
export const paymentsNotConfigured = () => new AppError(503, 'payments_not_configured', 'Payments are not configured on this server.', undefined, true);
// Fixed, generic text only: never the PayPal response, URL or any credential.
export const paymentError = (status: number, code: string, message: string) => new AppError(status, code, message, undefined, true);
export const aiNotConfigured = () => new AppError(503, 'ai_not_configured', 'The AI assistant is not configured on this server.', undefined, true);
export const aiUnavailable = (code: 'ai_unavailable' | 'ai_timeout' | 'ai_busy', message: string) => new AppError(code === 'ai_timeout' ? 504 : code === 'ai_busy' ? 503 : 502, code, message, undefined, true); // generic, fixed text: safe to show
