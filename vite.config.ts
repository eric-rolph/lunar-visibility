import { defineConfig } from "vitest/config";

export default defineConfig({
  root: "src",
  publicDir: "../public",
  build: {
    outDir: "../dist",
    emptyOutDir: true
  },
  test: {
    include: ["../tests/**/*.test.ts"]
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787"
    }
  }
});
