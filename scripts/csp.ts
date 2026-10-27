// Content-Security-Policy for the PRODUCTION build only (the dev server needs inline scripts for hot reload, so it is left alone).
// Why: the session token lives in browser storage, which any injected script could read. This policy blocks inline and third-party scripts,
// which is the main way such a script would get onto the page. It is a defence in depth, not a replacement for keeping the page free of untrusted code.
// A <meta> policy cannot set frame-ancestors; the API sends that header itself, and a static host should add it for the web app too.
export function apiOrigin(apiUrl: string | undefined): string | null {
  if (!apiUrl) return null;
  try { const u = new URL(apiUrl.trim()); return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null; } catch { return null; }
}
export function buildCsp(apiUrl?: string): string {
  const api = apiOrigin(apiUrl);
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // React inline style attributes (progress bars, graph) need this; scripts stay locked down
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${api ? ` ${api}` : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
export function injectCsp(html: string, apiUrl?: string): string {
  const tag = `<meta http-equiv="Content-Security-Policy" content="${buildCsp(apiUrl)}" />`;
  return html.includes('Content-Security-Policy') ? html : html.replace('<head>', `<head>${tag}`);
}

// `npm run csp -- https://your-api.example.com/api` prints the policy, to set as a header on a static host.
if (typeof process !== 'undefined' && /(^|[\\/])csp\.ts$/.test(process.argv[1] ?? '')) {
  console.log(`Content-Security-Policy: ${buildCsp(process.argv[2])}`);
  console.log('\nAlso send: X-Content-Type-Options: nosniff, Referrer-Policy: no-referrer, and frame-ancestors via Content-Security-Policy (not possible in a <meta> tag).');
}
