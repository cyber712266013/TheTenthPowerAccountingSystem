import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // رفع ملفات كبيرة (52 MB)
  experimental: {
    serverActions: {
      bodySizeLimit: '52mb',
    },
  },

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.googleusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'drive.google.com',
      },
    ],
  },
} satisfies NextConfig;

export default nextConfig;
