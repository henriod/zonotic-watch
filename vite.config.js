import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    // GDELT's DOC API sends no CORS headers, so the browser can't call it
    // directly. The dev server proxies it server-side: requests to /gdelt/*
    // are forwarded to api.gdeltproject.org with no CORS restriction.
    proxy: {
      "/gdelt": {
        target: "https://api.gdeltproject.org",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/gdelt/, ""),
      },
    },
  },
});
