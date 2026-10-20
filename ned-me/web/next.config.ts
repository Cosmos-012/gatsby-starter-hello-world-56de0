import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  // Actions serveur : l'en-tête Origin doit correspondre à l'hôte ; derrière Caddy on déclare l'hôte public.
  experimental: { serverActions: { bodySizeLimit: '6mb', allowedOrigins: process.env.PUBLIC_URL ? [new URL(process.env.PUBLIC_URL).host] : [] } },
  poweredByHeader: false,
  async redirects() { return [{ source: '/', destination: '/fr', permanent: false }]; },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
    ] }];
  },
};
export default config;
