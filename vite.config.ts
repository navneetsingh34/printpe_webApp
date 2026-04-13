import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 5174,
    },
    define: {
      "import.meta.env.API_BASE_URL": JSON.stringify(env.API_BASE_URL ?? ""),
      "import.meta.env.WS_BASE_URL": JSON.stringify(env.WS_BASE_URL ?? ""),
      "import.meta.env.GOOGLE_WEB_CLIENT_ID": JSON.stringify(
        env.GOOGLE_WEB_CLIENT_ID ?? "",
      ),
      "import.meta.env.AUTH_ACCESS_TOKEN_KEY": JSON.stringify(
        env.AUTH_ACCESS_TOKEN_KEY ?? "printpe_access_token",
      ),
      "import.meta.env.AUTH_REFRESH_TOKEN_KEY": JSON.stringify(
        env.AUTH_REFRESH_TOKEN_KEY ?? "printpe_refresh_token",
      ),
      "import.meta.env.RAZORPAY_KEY_ID": JSON.stringify(
        env.RAZORPAY_KEY_ID ?? "",
      ),
      "import.meta.env.RAZORPAY_MERCHANT_NAME": JSON.stringify(
        env.RAZORPAY_MERCHANT_NAME ?? "",
      ),
      "import.meta.env.ALLOW_RAZORPAY_TEST_MODE_ON_NON_LOCAL": JSON.stringify(
        env.ALLOW_RAZORPAY_TEST_MODE_ON_NON_LOCAL ?? "",
      ),
    },
    test: {
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
      globals: true,
    },
  };
});
