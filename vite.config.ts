import { defineConfig } from "vite";

// Commit SHA dari CI (GitHub) supaya pengguna bisa mencocokkan build dengan
// source. Kosong saat build lokal.
const buildSha = (process.env.GITHUB_SHA ?? "").slice(0, 12);
const buildTime = new Date().toISOString();

export default defineConfig({
  base: "./",
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  // sqlite-wasm memuat proxy worker secara dinamis (`?vfs=opfs`), yang tak
  // dikenali pre-bundler Vite. Kecualikan supaya dev tak memunculkan warning
  // "file does not exist ... optimize deps".
  optimizeDeps: {
    exclude: ["@sqlite.org/sqlite-wasm"],
  },
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
