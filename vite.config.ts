import { defineConfig } from "vite";

// Credentials stay in the backend; the browser only calls its own /api origin.
// Production hosting must route /api to the separately deployed Node server.
const proxy = { "/api": "http://127.0.0.1:3001" };

export default defineConfig({
  server: { port: 5173, strictPort: true, proxy },
  preview: { proxy },
});
