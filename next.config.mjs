/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // googleapis / @vercel/blob are only ever imported inside serverless ETL
  // routes. Keep them external so the client bundle stays lean.
  experimental: {
    serverComponentsExternalPackages: ['googleapis', '@vercel/blob'],
  },
};

export default nextConfig;
