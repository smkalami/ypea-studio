import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative, so one build works at the root of the domain and under a repository subpath.
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
  // The engine and the examples live one folder up.
  server: { fs: { allow: [".."] } },
});
