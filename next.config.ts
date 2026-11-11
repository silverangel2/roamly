import type { NextConfig } from "next";

const ffmpegFiles = [
  "./node_modules/@ffmpeg-installer/ffmpeg/**/*",
  "./node_modules/@ffmpeg-installer/linux-x64/**/*",
  "./node_modules/@ffmpeg-installer/darwin-arm64/**/*",
  "./node_modules/ffprobe-static/**/*",
  "./public/audio/reels/13. Background for HOSTS.mp3"
];

// Stage 5 (2026-11-11): Content-Security-Policy, two layers.
//  - REPORT-ONLY carries the full policy tuned to what the app actually
//    loads (census in STAGE5-HARDENING-REPORT.md): Supabase (REST +
//    realtime socket), the OpenFreeMap tile/style host, the Travelpayouts
//    and Stay22 widget origins, the next/image remote hosts, and the
//    inline script/style the Next runtime and Tailwind require today.
//    Violations report to the browser console only — no collector
//    endpoint exists yet, so script-src/style-src hardening (nonces)
//    stays a named follow-up, proven by triage before it ever enforces.
//  - ENFORCE carries only the directives proven safe against the tree:
//    frame-ancestors 'none' restates the X-Frame-Options: DENY posture
//    already live in production; base-uri 'self' (no <base> element
//    exists anywhere in app/components); form-action 'self' (every
//    form in the tree posts to this origin — Stripe checkout/portal
//    are top-level redirects, not form submissions); object-src 'none'
//    (no <object>/<embed> element exists in the tree).
const supabaseOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "").origin;
  } catch {
    return "https://*.supabase.co";
  }
})();
const supabaseSocketOrigin = supabaseOrigin.replace(/^http/, "ws");

const contentSecurityPolicyReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://tpwdgt.com https://scripts.stay22.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://images.unsplash.com https://m.media-amazon.com https://images-na.ssl-images-amazon.com https://images-eu.ssl-images-amazon.com https://*.bstatic.com https://res.klook.com https://commons.wikimedia.org https://tiles.openfreemap.org",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseOrigin} ${supabaseSocketOrigin} https://tiles.openfreemap.org https://api.open-meteo.com`,
  "frame-src 'self' https://tpwdgt.com https://booking.stay22.com https://www.stay22.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' blob: data:",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'"
].join("; ");

const contentSecurityPolicyEnforced = [
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'"
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,

  // P0-2: baseline HTTP security headers (+ Stage 5 CSP layers above).
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
          { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicyReportOnly },
          { key: "Content-Security-Policy", value: contentSecurityPolicyEnforced }
        ]
      }
    ];
  },

  serverExternalPackages: ["@ffmpeg-installer/ffmpeg"],

  outputFileTracingIncludes: {
    "/api/cron/roamly-social-autopost": ffmpegFiles,
    "/api/admin/roamly/social/automation": ffmpegFiles,
    "/api/admin/roamly/social/generate": ffmpegFiles
  },

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com"
      },
      {
        protocol: "https",
        hostname: "m.media-amazon.com"
      },
      {
        protocol: "https",
        hostname: "images-na.ssl-images-amazon.com"
      },
      {
        protocol: "https",
        hostname: "images-eu.ssl-images-amazon.com"
      },
      {
        protocol: "https",
        hostname: "**.bstatic.com"
      },
      {
        protocol: "https",
        hostname: "res.klook.com"
      }
    ]
  }
};

// The app's Trips experience lives at /dashboard; /trips is a route alias so
// bookmarks and links to /trips do not 404.
nextConfig.redirects = async () => [
  {
    source: "/trips",
    destination: "/dashboard",
    permanent: false
  },
  {
    // Every other /trips/* path still lands on /dashboard, EXCEPT the bare
    // /trips/share segment: app/trips/share is a real page (Itinerary Library
    // share form) that the old "/trips/:path*" wildcard shadowed. The regex
    // refuses to match the exact "share" segment, so the page serves;
    // /trips/share/* subpaths keep redirecting, exactly as before.
    source: "/trips/:path((?!share$).*)",
    destination: "/dashboard",
    permanent: false
  },
  {
    // "Finds" was renamed "Deals" in the UI but no /deals route was ever
    // created, so the address 404'd. Land it on the real page, same pattern
    // as /alerts below.
    source: "/deals",
    destination: "/finds",
    permanent: false
  },
  {
    source: "/deals/:path*",
    destination: "/finds",
    permanent: false
  },
  {
    source: "/alerts",
    destination: "/notifications",
    permanent: false
  }
];

export default nextConfig;
