import { defineConfig } from "vite";

// Browser requests stay same-origin; Supabase holds all execution credentials.
const proxy = {
  "/api": {
    target: "http://127.0.0.1:54321",
    rewrite: (path: string) => `/functions/v1/execution${path}`,
  },
};

export default defineConfig({
  server: { port: 5173, strictPort: true, proxy },
  preview: { proxy },
});
