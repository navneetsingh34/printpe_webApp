import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./auth-context";
import { AuthFormLayout } from "./AuthFormLayout";
import { PrinterLoading } from "../../shared/ui/PrinterLoading";
import { env } from "../../services/api/env";
import { GoogleLogoIcon } from "./GoogleLogoIcon";
import { createDirectGoogleIdTokenUrl } from "./googleOAuth";

function resolveOAuthApiBaseUrl() {
  const configured = env.apiBaseUrl.replace(/\/$/, "");

  try {
    const configuredUrl = new URL(configured);
    const currentHost = window.location.hostname;
    const configuredHost = configuredUrl.hostname;
    const configuredIsLocal =
      configuredHost === "localhost" || configuredHost === "127.0.0.1";
    const currentIsLocal =
      currentHost === "localhost" || currentHost === "127.0.0.1";

    if (configuredIsLocal && !currentIsLocal) {
      return `${window.location.origin}/api/v1`;
    }
  } catch {
    // Fall back to configured API base URL.
  }

  return configured;
}

export function LoginPage() {
  const { signIn, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const hashParams = new URLSearchParams(
      window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "",
    );
    const idTokenFromHash = hashParams.get("id_token")?.trim();
    const oauthError = hashParams.get("error")?.trim();

    if (!idTokenFromHash && !oauthError) {
      return;
    }

    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`,
    );

    if (oauthError) {
      setError(`Google login failed: ${oauthError}`);
      return;
    }

    if (!idTokenFromHash) {
      setError("Google login failed. Missing ID token.");
      return;
    }

    setLoading(true);
    setError("");
    void signInWithGoogle({ idToken: idTokenFromHash })
      .then(() => {
        navigate("/");
      })
      .catch((e: unknown) => {
        setError((e as Error).message || "Google login failed.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [navigate, signInWithGoogle]);

  const onGoogleLogin = () => {
    setError("");
    const returnUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    const directGoogleUrl = createDirectGoogleIdTokenUrl(returnUrl);
    if (directGoogleUrl) {
      window.location.href = directGoogleUrl;
      return;
    }

    const oauthApiBaseUrl = resolveOAuthApiBaseUrl();
    const oauthStartUrl = `${oauthApiBaseUrl}/auth/google/mobile/start?mobileRedirectUri=${encodeURIComponent(returnUrl)}`;
    window.location.href = oauthStartUrl;
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    if (!email.trim() || !password) {
      setError("Please enter both email and password.");
      return;
    }

    setLoading(true);
    try {
      await signIn({ email: email.trim().toLowerCase(), password });
      navigate("/");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <AuthFormLayout
        variant="login"
        title="Welcome Back"
        subtitle="Sign in to continue your print workflow."
      >
        <div className="loader-screen">
          <PrinterLoading />
        </div>
      </AuthFormLayout>
    );
  }

  return (
    <AuthFormLayout
      variant="login"
      title="Welcome Back"
      subtitle="Sign in to continue your print workflow."
    >
      <form onSubmit={onSubmit} className="form auth-form">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          type="email"
          autoComplete="email"
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder="Password"
        />
        {error ? <p className="error">{error}</p> : null}
        <button className="btn-primary" type="submit" disabled={loading}>
          Login to PrintPe
        </button>
        <div className="auth-or-divider" role="separator" aria-label="or">
          <span>or</span>
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={onGoogleLogin}
          disabled={loading}
        >
          <span className="btn-with-icon">
            <GoogleLogoIcon />
            <span>Continue with Google</span>
          </span>
        </button>
        <div className="auth-links-row">
          <Link to="/auth/forgot-password">Forgot password?</Link>
          <p>
            New here? <Link to="/auth/register">Create account</Link>
          </p>
        </div>
      </form>
    </AuthFormLayout>
  );
}
