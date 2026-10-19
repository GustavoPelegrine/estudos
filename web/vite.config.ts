import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "127.0.0.1",
    // Em desenvolvimento, /api é encaminhado ao backend local (em produção o Firebase Hosting faz isso).
    proxy: { "/api": { target: "http://127.0.0.1:8080", changeOrigin: false } },
  },
  build: { sourcemap: false, target: "es2022" },
  test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"], css: false },
});
