import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// base is set from BASE_PATH so the same build works at
// https://<user>.github.io/<repo>/ and at a custom domain root.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: process.env.BASE_PATH || "/",
  build: { outDir: "dist", sourcemap: false },
});
