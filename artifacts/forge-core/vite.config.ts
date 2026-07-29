import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

function resolveOptionalPort(
  rawPort: string | undefined,
): number | undefined {
  if (!rawPort) {
    return undefined;
  }

  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  return port;
}

export default defineConfig(async ({ command }) => {
  const port = resolveOptionalPort(process.env.PORT);
  const basePath = process.env.BASE_PATH ?? "/";

  const replitPlugins =
    command === "serve" && process.env.REPL_ID
      ? [
          (
            await import(
              "@replit/vite-plugin-cartographer"
            )
          ).cartographer({
            root: path.resolve(import.meta.dirname, "../"),
          }),
          (
            await import(
              "@replit/vite-plugin-dev-banner"
            )
          ).devBanner(),
        ]
      : [];

  return {
    base: basePath,
    plugins: [
      react(),
      tailwindcss(),
      runtimeErrorOverlay(),
      ...replitPlugins,
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@assets": path.resolve(
          import.meta.dirname,
          "..",
          "..",
          "attached_assets",
        ),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(
        import.meta.dirname,
        "dist/public",
      ),
      emptyOutDir: true,
    },
    server: {
      ...(port === undefined ? {} : { port }),
      strictPort: port !== undefined,
      host: "0.0.0.0",
      allowedHosts: true,
      proxy: {
        "/api": {
          target:
            process.env.FORGE_API_URL ??
            "http://localhost:5000",
          changeOrigin: true,
        },
      },
      fs: {
        strict: true,
      },
    },
    preview: {
      ...(port === undefined ? {} : { port }),
      host: "0.0.0.0",
      allowedHosts: true,
    },
  };
});