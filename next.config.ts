import type { NextConfig } from "next";

const ffmpegFiles = [
  "./node_modules/@ffmpeg-installer/ffmpeg/**/*",
  "./node_modules/@ffmpeg-installer/linux-x64/**/*",
  "./node_modules/@ffmpeg-installer/darwin-arm64/**/*",
  "./node_modules/ffprobe-static/**/*",
  "./public/audio/reels/13. Background for HOSTS.mp3"
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,

  // P0-2: baseline HTTP security headers. No blocking CSP — Travelpayouts/Stay22
  // widgets and inline scripts would break; consider CSP-Report-Only first.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" }
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
