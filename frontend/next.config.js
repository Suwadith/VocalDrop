/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  allowedDevOrigins: ['192.168.1.159', '91.125.155.226'],
  experimental: {
    proxyClientMaxBodySize: '500mb',
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: process.env.BACKEND_URL || 'http://127.0.0.1:8000/api/:path*'
      }
    ]
  }
};

module.exports = nextConfig;
