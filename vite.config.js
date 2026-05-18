import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
//
// No dev proxy: the browser talks to the FastAPI backend directly via
// VITE_API_BASE, which sends proper CORS headers. The old `/gdelt` proxy
// is gone — GDELT is now called server-side from the Temporal worker.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
  },
});
