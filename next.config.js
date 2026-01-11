/** @type {import('next').NextConfig} */
const nextConfig = {
  // Add serverExternalPackages to opt-out specific dependencies from bundling  
  serverExternalPackages: ['websocket', 'natural', 'pdf-parse', 'pdf2pic', 'tesseract.js', 'tesseract.js-core', '@dqbd/tiktoken', 'tiktoken'],

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
    // Fix: Tesseract.js worker configuration
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
        'webworker-threads': false,
      }
    }
    // Fix: Suppress Supabase Realtime critical dependency warning
    config.module = {
      ...config.module,
      exprContextCritical: false,
      unknownContextCritical: false,
    }

    // Fix: Add tiktoken WASM support
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true
    }
    
    // Fix: Handle tiktoken WASM files for both client and server
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      crypto: false,
      'webworker-threads': false,
    }

    // Special handling for @dqbd/tiktoken WASM files
    if (isServer) {
      // Allow tiktoken to bundle normally on server
      config.resolve.alias = {
        ...config.resolve.alias,
        '@dqbd/tiktoken': '@dqbd/tiktoken'
      }
    }

    // Remove this redundant section since we handle fallbacks above
    
    // Fix: Add rule for WASM files with proper handling
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
      generator: {
        filename: 'static/wasm/[hash][ext][query]',
      },
    })

    // Fix: Better handling for tiktoken WASM
    config.resolve.alias = {
      ...config.resolve.alias,
      '@dqbd/tiktoken': '@dqbd/tiktoken',
    }

    // Fix: Suppress warnings for Supabase Realtime client
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      {
        module: /node_modules\/@supabase\/realtime-js/,
        message: /Critical dependency: the request of a dependency is an expression/,
      },
    ]
    
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
            // Fix: Tiktoken vendor chunk
            tiktoken: {
              test: /[\\/]node_modules[\\/]@dqbd[\\/]tiktoken[\\/]/,
              name: 'tiktoken-vendor',
              chunks: 'all',
              priority: 25,
            },
          },
        },
      }
    }

    // Optimize imports and ensure proper module resolution
    config.resolve.alias = {
      ...config.resolve.alias,
      // Reduce lodash bundle size
      'lodash': 'lodash-es',
      // Explicitly resolve the path aliases
      '@': process.cwd(),
    }

    // Ensure better module resolution for TypeScript paths
    config.resolve.modules = [
      'node_modules',
      process.cwd(),
    ]

    return config
  },

  // Image optimization
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 31536000, // 1 year
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    remotePatterns: [
      {
        protocol: 'http',
        hostname: '172.20.10.3'
      }
    ]
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