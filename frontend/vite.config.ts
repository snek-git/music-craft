import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [
    svelte({
      compilerOptions: {
        hydratable: false,
      },
    }),
  ],
  resolve: {
    conditions: ["browser", "import", "module", "default"],
  },
  server: {
    port: 5173,
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:3001",
    },
  },
});
