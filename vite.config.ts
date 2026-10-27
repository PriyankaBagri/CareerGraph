import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { injectCsp } from './scripts/csp';

// The Content-Security-Policy is added to index.html at BUILD time only (npm run build); `npm run dev` is unchanged.
export default defineConfig(({ mode }) => {
  const apiUrl = loadEnv(mode, process.cwd(), 'VITE_').VITE_API_URL;
  return { plugins: [react(), { name: 'careergraph-csp', apply: 'build', transformIndexHtml: (html: string) => injectCsp(html, apiUrl) }] };
});
