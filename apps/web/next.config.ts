import type { NextConfig } from "next";

/**
 * The web app is a static export: the demo on Netlify is files only, and the same build talks to
 * the server when NEXT_PUBLIC_API_URL is set. Query strings carry ids because a static export
 * cannot enumerate them.
 */
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: false,
  reactStrictMode: true,
};

export default nextConfig;
