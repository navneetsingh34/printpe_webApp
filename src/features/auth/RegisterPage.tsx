import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./auth-context";
import { AuthFormLayout } from "./AuthFormLayout";
import { PrinterLoading } from "../../shared/ui/PrinterLoading";
import { env } from "../../services/api/env";
import { GoogleLogoIcon } from "./GoogleLogoIcon";

const consentStorageKey = "printpe.signup.acceptedTerms";

export function RegisterPage() {
  const { registerWithGoogle, signUp } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [acceptedTerms, setAcceptedTerms] = useState(
    () => window.sessionStorage.getItem(consentStorageKey) === "true",
  );
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
      setError(`Google authentication failed: ${oauthError}`);
      return;
    }

    if (!idTokenFromHash) {
      setError("Google authentication failed. Missing ID token.");
      return;
    }

    setLoading(true);
    setError("");
    void registerWithGoogle({ idToken: idTokenFromHash, acceptedTerms: true })
      .then(() => {
        window.sessionStorage.removeItem(consentStorageKey);
        navigate("/");
      })
      .catch((e: unknown) => {
        setError((e as Error).message || "Google authentication failed.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [navigate, registerWithGoogle]);

  const onGoogleSignUp = () => {
    setError("");
    window.sessionStorage.setItem(consentStorageKey, "true");
    const returnUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    const oauthApiBaseUrl = env.apiBaseUrl.replace(/\/$/, "");
    const oauthStartUrl = `${oauthApiBaseUrl}/auth/google/mobile/start?mobileRedirectUri=${encodeURIComponent(returnUrl)}`;
    window.location.href = oauthStartUrl;
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    if (
      !form.firstName.trim() ||
      !form.lastName.trim() ||
      !form.email.trim() ||
      !form.password
    ) {
      setError("Please complete required fields.");
      return;
    }
    if (form.password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!acceptedTerms) {
      setError(
        "Please accept the terms and privacy policy to create an account.",
      );
      return;
    }

    setLoading(true);
    try {
      const response = await signUp({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        role: "user",
        acceptedTerms,
      });
      window.sessionStorage.removeItem(consentStorageKey);
      navigate(
        `/auth/verify-email?email=${encodeURIComponent(response.user.email)}`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <AuthFormLayout
        variant="signup"
        title="Create Account"
        subtitle="Create your PrintPe account in less than a minute."
      >
        <div className="loader-screen">
          <PrinterLoading />
        </div>
      </AuthFormLayout>
    );
  }

  return (
    <AuthFormLayout
      variant="signup"
      title="Create Account"
      subtitle="Create your PrintPe account in less than a minute."
    >
      <form onSubmit={onSubmit} className="form auth-form">
        <input
          placeholder="First name"
          value={form.firstName}
          onChange={(e) =>
            setForm((p) => ({ ...p, firstName: e.target.value }))
          }
        />
        <input
          placeholder="Last name"
          value={form.lastName}
          onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))}
        />
        <input
          placeholder="Email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
        />
        <input
          type="password"
          placeholder="Password"
          value={form.password}
          onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
        />
        <input
          type="password"
          placeholder="Confirm password"
          value={form.confirmPassword}
          onChange={(e) =>
            setForm((p) => ({ ...p, confirmPassword: e.target.value }))
          }
        />
        <label className="auth-consent">
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => {
              const next = e.target.checked;
              setAcceptedTerms(next);
              if (next) {
                window.sessionStorage.setItem(consentStorageKey, "true");
              } else {
                window.sessionStorage.removeItem(consentStorageKey);
              }
            }}
          />
          <span>
            I agree to the Terms and Privacy Policy before creating my account.
          </span>
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button className="btn-primary" type="submit" disabled={loading}>
          Create PrintPe account
        </button>
        <div className="auth-or-divider" role="separator" aria-label="or">
          <span>or</span>
        </div>
        <button
          className="btn-secondary"
          type="button"
          onClick={onGoogleSignUp}
          disabled={loading}
        >
          <span className="btn-with-icon">
            <GoogleLogoIcon />
            <span>Continue with Google</span>
          </span>
        </button>
        <p className="auth-footnote">
          Already have account? <Link to="/auth/login">Login</Link>
        </p>
      </form>
    </AuthFormLayout>
  );
}
