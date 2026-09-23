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
      }
    ]
  }
};

export default nextConfig;
