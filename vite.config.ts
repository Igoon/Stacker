import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    headers: {
      // Tidak wajib untuk opfs-sahpool, tapi aman untuk SharedArrayBuffer bila
      // host nanti memakai VFS "opfs". Tidak merugikan.
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  build: {
    target: "es2022",
  },
  worker: {
    format: "es",
  },
});
