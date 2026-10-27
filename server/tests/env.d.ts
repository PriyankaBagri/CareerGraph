// Lets the frontend's api.ts (which reads import.meta.env) type-check inside the server's tsconfig, mirroring the parts of Vite's ImportMetaEnv it uses.
// `DEV` is a boolean in Vite (not a string); `env` is optional because the Node test runner has no import.meta.env at all.
interface ImportMeta { readonly env?: { readonly DEV?: boolean; readonly VITE_API_URL?: string; readonly [key: string]: unknown } }
