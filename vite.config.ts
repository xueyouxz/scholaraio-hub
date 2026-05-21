import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { resolveDerivedPorts } from "./packages/shared/src/ports";

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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  const host = env.HOST || "127.0.0.1";
  const ports = resolveDerivedPorts({ ...process.env, ...env });

  return {
    root: path.resolve(__dirname, "packages/client"),
    envDir: __dirname,
    plugins: [tailwindcss(), react()],
    server: {
      host,
      port: ports.client,
      strictPort: true,
      proxy: {
        "/api": {
          target: `http://${host}:${ports.app}`,
          changeOrigin: false,
        },
        "/hub": {
          target: `http://${host}:${ports.app}`,
          changeOrigin: false,
        },
        "/health": {
          target: `http://${host}:${ports.app}`,
          changeOrigin: false,
        },
      },
    },
    preview: {
      host,
      port: ports.preview,
      strictPort: true,
    },
    build: {
      outDir: path.resolve(__dirname, "packages/client/dist"),
      emptyOutDir: true,
      sourcemap: true,
    },
    define: {
      __APP_VERSION__: JSON.stringify(resolveAppVersion()),
    },
  };
});
