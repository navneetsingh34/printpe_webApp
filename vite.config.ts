import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    define: {
      "import.meta.env.API_BASE_URL": JSON.stringify(env.API_BASE_URL ?? ""),
      "import.meta.env.WS_BASE_URL": JSON.stringify(env.WS_BASE_URL ?? ""),
      "import.meta.env.AUTH_ACCESS_TOKEN_KEY": JSON.stringify(
        env.AUTH_ACCESS_TOKEN_KEY ?? "printq_access_token",
      ),
      "import.meta.env.AUTH_REFRESH_TOKEN_KEY": JSON.stringify(
        env.AUTH_REFRESH_TOKEN_KEY ?? "printq_refresh_token",
      ),
      "import.meta.env.RAZORPAY_KEY_ID": JSON.stringify(
        env.RAZORPAY_KEY_ID ?? "",
      ),
      "import.meta.env.RAZORPAY_MERCHANT_NAME": JSON.stringify(
        env.RAZORPAY_MERCHANT_NAME ?? "",
      ),
    },
    test: {
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
      globals: true,
    },
  };
});
