import { env } from "../../services/api/env";

export function createDirectGoogleIdTokenUrl(returnUrl: string): string | null {
  const clientId = env.googleWebClientId?.trim();
  if (!clientId) {
    return null;
  }

  const nonce =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: returnUrl,
    response_type: "id_token",
    scope: "openid email profile",
    nonce,
    prompt: "select_account",
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`;
}
