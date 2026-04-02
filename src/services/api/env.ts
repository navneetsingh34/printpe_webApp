function required(name: string, value: string | undefined): string {
  if (!value || !value.trim()) {
    if (import.meta.env.MODE === "test") {
      if (name === "VITE_API_BASE_URL") return "http://localhost:3000/api/v1";
      if (name === "VITE_WS_BASE_URL") return "http://localhost:3000";
    }
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function optional(value: string | undefined): string {
  return (value ?? "").trim();
}

export const env = {
  apiBaseUrl: required(
    "VITE_API_BASE_URL",
    import.meta.env.VITE_API_BASE_URL as string | undefined,
  ),
  wsBaseUrl: required(
    "VITE_WS_BASE_URL",
    import.meta.env.VITE_WS_BASE_URL as string | undefined,
  ),
  accessTokenKey:
    (import.meta.env.VITE_AUTH_ACCESS_TOKEN_KEY as string | undefined) ??
    "printq_access_token",
  refreshTokenKey:
    (import.meta.env.VITE_AUTH_REFRESH_TOKEN_KEY as string | undefined) ??
    "printq_refresh_token",
  razorpayKeyId: optional(
    import.meta.env.VITE_RAZORPAY_KEY_ID as string | undefined,
  ),
  razorpayMerchantName: optional(
    import.meta.env.VITE_RAZORPAY_MERCHANT_NAME as string | undefined,
  ),
} as const;
