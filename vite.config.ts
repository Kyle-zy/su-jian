import { defineConfig } from "vite";

// Tauri 通过 file:// 加载前端资源，因此必须使用相对路径。
export default defineConfig({
  base: "./",
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
