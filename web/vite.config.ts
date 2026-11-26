import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { APP_VERSION, YPEA_TESTED } from "../engine/run.ts";

export default defineConfig({
  // Relative, so one build works at the root of the domain and under a repository subpath.
  base: "./",
  plugins: [
    react(),
    {
      // The guide is static HTML. Its two version numbers come from the engine, so they cannot go stale.
      name: "versions-in-pages",
      transformIndexHtml: (html) => html.replaceAll("%APP_VERSION%", APP_VERSION).replaceAll("%YPEA_TESTED%", YPEA_TESTED),
    },
  ],
  build: { rollupOptions: { input: ["index.html", "guide.html"] } },
  worker: { format: "es" },
  // The engine and the examples live one folder up.
  server: { fs: { allow: [".."] } },
});
