import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    // Bundle our own workspace core (TS source) into main; externalize node/native deps.
    plugins: [externalizeDepsPlugin({ exclude: ["@agent-summa/core"] })],
    resolve: { alias: { "@shared": resolve("src/shared") } },
    build: {
      outDir: "out/main",
      rollupOptions: {
        // index = main process; fts-worker = off-main utilityProcess for message-content indexing.
        input: { index: resolve("src/main/index.ts"), "fts-worker": resolve("src/main/fts-worker.ts") },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
      rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } },
    },
  },
  renderer: {
    plugins: [react()],
    resolve: { alias: { "@shared": resolve("src/shared"), "@renderer": resolve("src/renderer") } },
    root: "src/renderer",
    build: { outDir: "out/renderer" },
  },
});
