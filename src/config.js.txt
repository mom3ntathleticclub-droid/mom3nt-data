// Resolves your live site URL from an env var (Netlify) or falls back to current origin
export const SITE_URL =
  (import.meta && import.meta.env && import.meta.env.VITE_SITE_URL) ||
  (typeof window !== 'undefined' ? window.location.origin : '');
