import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ['lucide-react', 'viem']
  },
  webpack: (config) => {
    config.resolve.fallback = { fs: false, net: false, tls: false }
    config.externals.push('pino-pretty', 'encoding')
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      { module: /ox[\\/]_esm[\\/]tempo[\\/]internal[\\/]virtualMasterPool/ },
    ]
    return config
  }
}

export default nextConfig
