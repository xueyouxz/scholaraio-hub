import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveAppVersion(): string {
  const packageJsonPath = path.resolve(__dirname, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
    version?: string;
  };

  try {
    const sha = execSync("git rev-parse --short HEAD", {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString("utf-8")
      .trim();

    return sha ? `${packageJson.version ?? "0.0.1"}+${sha}` : (packageJson.version ?? "0.0.1");
  } catch {
    return packageJson.version ?? "0.0.1";
  }
}

// Builds the client, and configures the dev server that `packages/server`
// runs in middleware mode on the application's own port (src/frontend/dev.ts).
export default defineConfig(({ mode }) => {
  const isDev = mode === "development";

  return {
    root: path.resolve(__dirname, "packages/client"),
    envDir: __dirname,
    plugins: [tailwindcss(), react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "packages/client/src"),
      },
      // Dev reads @scholaraio-hub/shared from source (like the tsx server), so
      // shared edits apply without rebuilding packages/shared/dist.
      conditions: isDev ? ["scholaraio-source"] : [],
    },
    build: {
      outDir: path.resolve(__dirname, "packages/client/dist"),
      emptyOutDir: true,
      sourcemap: isDev ? true : process.env.SOURCEMAP === "true" ? "hidden" : false,
      target: "es2022",
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks: {
            "vendor-react": ["react", "react-dom", "react-router-dom"],
            "vendor-query": ["@tanstack/react-query"],
            "vendor-pdf": ["react-pdf", "pdfjs-dist"],
            "vendor-viz": ["d3"],
            "vendor-md": [
              "react-markdown",
              "remark-gfm",
              "remark-math",
              "rehype-katex",
              "rehype-raw",
              "katex",
            ],
          },
        },
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(resolveAppVersion()),
    },
  };
});
