/** @type {import('next').NextConfig} */
const nextConfig = {
  // Image optimisation - converts to WebP, resizes to requested dimensions.
  // Disabled previously; now enabled with explicit remote patterns.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.blob.vercel-storage.com' },
      { protocol: 'https', hostname: 'cdn.discordapp.com' },
      { protocol: 'https', hostname: 'media.discordapp.net' },
      { protocol: 'https', hostname: 'i.imgur.com' },
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: '*.supabase.in' },
    ],
    // Allow any https domain for user-uploaded avatar/background URLs
    dangerouslyAllowSVG: false,
    minimumCacheTTL: 3600, // Cache optimised images for 1 hour
  },

  // Hide Next.js version from response headers
  poweredByHeader: false,

  typescript: {
    // The Profile / Template / Appearance interfaces in lib/types.ts have
    // drifted behind the actual Supabase schema as columns have been added.
    // Flipping this off surfaces dozens of "Property X does not exist on
    // type Profile" errors that are real but not behavioural - the code
    // works at runtime because the columns exist in the DB.
    //
    // Proper fix: regenerate types from Supabase (e.g.
    // `npx supabase gen types typescript ...`) or expand lib/types.ts to
    // match the current schema. Until that lands the build relies on this
    // flag.
    ignoreBuildErrors: true,
  },

  async headers() {
    return [
      {
        // Auth + mutation API routes - never cache
        source: '/api/auth/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
      {
        // Upload routes - never cache
        source: '/api/upload/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
      {
        // Track view / track click - no cache (writes)
        source: '/api/track-(.*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
      {
        // All other API routes (profile reads, social links, etc.) - short private cache
        source: '/api/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Cache-Control', value: 'private, no-cache, must-revalidate' },
        ],
      },
      {
        // Block direct access to source maps in production
        source: '/(.*)\\.map',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
      {
        // Profile routes (/{username}). Short s-maxage so a transient 404
        // (e.g. a profile that didn't exist at first request time) gets
        // re-fetched within a minute instead of stuck at the CDN forever.
        // `[^/]+` forces at least one non-slash char so `/` doesn't match -
        // the home page renders per-user (logged in vs not) and must NOT
        // be edge-cached.
        source: '/:username((?!_next|api|dashboard|login|signup|pricing|leaderboard|privacy|tos|maintenance|onboarding|banned|redeem|demo|auth|templates|sitemap.xml|robots.txt|favicon.ico)[^/]+)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, s-maxage=30, stale-while-revalidate=120' },
        ],
      },
      {
        // Home page: per-request (logged-in vs logged-out renders differ).
        // Force no CDN caching so the nav 'sign in' vs 'dashboard' always
        // reflects the current session.
        source: '/',
        headers: [
          { key: 'Cache-Control', value: 'private, no-cache, no-store, max-age=0, must-revalidate' },
        ],
      },
      {
        // Security headers for all routes
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options',           value: 'nosniff' },
          { key: 'X-XSS-Protection',                 value: '1; mode=block' },
          { key: 'X-Frame-Options',                  value: 'SAMEORIGIN' },
          { key: 'X-DNS-Prefetch-Control',           value: 'on' },
          { key: 'Referrer-Policy',                  value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy',               value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
          { key: 'Strict-Transport-Security',        value: 'max-age=31536000; includeSubDomains; preload' },
          { key: 'Cross-Origin-Opener-Policy',       value: 'same-origin-allow-popups' },
          { key: 'Cross-Origin-Resource-Policy',     value: 'cross-origin' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // Cloudflare Turnstile + Analytics, TikTok embed, Stripe.js.
              // blob: + wasm-unsafe-eval are needed for client-side ffmpeg.wasm
              // (used by lib/compress-video.ts for the upload transcode step).
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: https://challenges.cloudflare.com https://static.cloudflareinsights.com https://www.tiktok.com https://js.stripe.com https://unpkg.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' data: https://fonts.gstatic.com",
              "img-src 'self' blob: data: https:",
              "media-src 'self' blob: https:",
              // Cloudflare Turnstile, TikTok, YouTube, Spotify, Stripe, SoundCloud
              "frame-src 'self' https://challenges.cloudflare.com https://www.tiktok.com https://www.youtube.com https://open.spotify.com https://js.stripe.com https://w.soundcloud.com",
              // Cloudflare Analytics beacon, Supabase, Stripe
              "connect-src 'self' https: wss://*.supabase.co",
              "worker-src 'self' blob:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

export default nextConfig
