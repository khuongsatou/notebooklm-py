import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const disableViteClient =
    mode === "production" ||
    process.env.NOTEBOOKLM_DESKTOP_DISABLE_HMR === "1" ||
    process.env.VITE_NOTEBOOKLM_DISABLE_HMR === "1";

  return {
    base: "./",
    plugins: [
      react(),
      {
        name: "notebooklm-strip-vite-client",
        apply: "serve",
        transformIndexHtml: {
          order: "post",
          handler(html) {
            if (!disableViteClient) return html;
            return html.replace(
              /\s*<script\b[^>]*\bsrc=["'][^"']*\/@vite\/client["'][^>]*><\/script>\s*/g,
              "\n",
            );
          },
        },
      },
    ],
    server: {
      host: "127.0.0.1",
      port: 5173,
      hmr: disableViteClient ? false : undefined,
    },
  };
});
