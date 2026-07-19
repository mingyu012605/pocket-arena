import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  server: {
    allowedHosts: [".trycloudflare.com"]
  },
  build: {
    outDir: "../dist/client",
    emptyOutDir: true
  }
});
