import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    dts: { resolve: true },
    sourcemap: true,
    clean: true,
    treeshake: true,
    external: [
      "better-sqlite3",
      "fastembed",
      "@google/genai",
    ],
  },
]);
