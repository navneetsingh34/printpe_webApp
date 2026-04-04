function required(name: string, value: string | undefined): string {
  if (!value || !value.trim()) {
    if (import.meta.env.MODE === "test") {
      if (name === "API_BASE_URL") return "http://localhost:3000/api/v1";
      if (name === "WS_BASE_URL") return "http://localhost:3000";
    }
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function optional(value: string | undefined): string {
  return (value ?? "").trim();
}

function withDefault(value: string | undefined, fallback: string): string {
  const normalized = (value ?? "").trim();
  return normalized || fallback;
}

const metaEnv = import.meta.env as Record<string, string | undefined>;

export const env = {
  apiBaseUrl: required("API_BASE_URL", metaEnv.API_BASE_URL),
  wsBaseUrl: required("WS_BASE_URL", metaEnv.WS_BASE_URL),
  googleWebClientId: optional(metaEnv.GOOGLE_WEB_CLIENT_ID),
  googleCallbackUrl: optional(metaEnv.GOOGLE_CALLBACK_URL),
  accessTokenKey: withDefault(metaEnv.AUTH_ACCESS_TOKEN_KEY, "printq_access_token"),
  refreshTokenKey: withDefault(metaEnv.AUTH_REFRESH_TOKEN_KEY, "printq_refresh_token"),
  razorpayKeyId: optional(metaEnv.RAZORPAY_KEY_ID),
  razorpayMerchantName: optional(metaEnv.RAZORPAY_MERCHANT_NAME),
} as const;
