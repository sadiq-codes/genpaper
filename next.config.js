/** @type {import('next').NextConfig} */
const nextConfig = {
  // Performance optimizations
  experimental: {
    optimizePackageImports: [
      '@radix-ui/react-icons',
      'lucide-react',
      '@supabase/supabase-js',
      '@citation-js/core'
    ],
  },

  // Bundle optimization
  webpack: (config, { dev, isServer }) => {
    // Optimize for production builds
    if (!dev && !isServer) {
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          chunks: 'all',
          cacheGroups: {
            // Vendor chunks for better caching
            vendor: {
              test: /[\\/]node_modules[\\/]/,
              name: 'vendors',
              chunks: 'all',
              priority: 10,
            },
            // AI SDK chunks
            ai: {
              test: /[\\/]node_modules[\\/](@ai-sdk|openai|ai)[\\/]/,
              name: 'ai-vendor',
              chunks: 'all',
              priority: 20,
            },
            // Supabase chunks
            supabase: {
              test: /[\\/]node_modules[\\/]@supabase[\\/]/,
              name: 'supabase-vendor',
              chunks: 'all',
              priority: 20,
            },
            // TipTap editor chunks
            editor: {
              test: /[\\/]node_modules[\\/]@tiptap[\\/]/,
              name: 'editor-vendor',
              chunks: 'all',
              priority: 20,
            },
            // Citation processing chunks
            citations: {
              test: /[\\/]node_modules[\\/]@citation-js[\\/]/,
              name: 'citations-vendor',
              chunks: 'all',
              priority: 20,
            },
            // UI components
            ui: {
              test: /[\\/]node_modules[\\/](@radix-ui|cmdk)[\\/]/,
              name: 'ui-vendor',
              chunks: 'all',
              priority: 15,
            },
          },
        },
      }
    }

    // Optimize imports
    config.resolve.alias = {
      ...config.resolve.alias,
      // Reduce lodash bundle size
      'lodash': 'lodash-es',
    }

    return config
  },

  // Image optimization
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 31536000, // 1 year
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },

  // Compression
  compress: true,

  // Headers for performance
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin',
          },
        ],
      },
      // Cache static assets
      {
        source: '/static/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      // Cache API responses briefly
      {
        source: '/api/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=60, stale-while-revalidate=300',
          },
        ],
      },
    ]
  },

  // Enable gzip compression
  poweredByHeader: false,

  // Reduce build output
  output: 'standalone',

  // Move experimental.turbo to config.turbopack
  turbopack: {
    rules: {
      '*.svg': {
        loaders: ['@svgr/webpack'],
        as: '*.js',
      },
    },
  },
}

module.exports = nextConfig 