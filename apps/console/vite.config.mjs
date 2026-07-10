import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Local preview harness for the Ghost-Ark console. Isolated from the AWS
// Lambda (apps/api) and CDK build outputs: this config is `.mjs` so the root
// `tsc -p tsconfig.json` (include: apps/**/*.ts,tsx) never type-checks it, and
// it emits nothing into dist/. Dev only.
export default defineConfig({
  root: ".",
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    strictPort: true,
  },
});
