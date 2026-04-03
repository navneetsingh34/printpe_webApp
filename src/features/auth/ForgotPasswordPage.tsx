import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./auth-context";
import { AuthFormLayout } from "./AuthFormLayout";
import { PrinterLoading } from "../../shared/ui/PrinterLoading";

export function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("email") ?? "";
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Enter your email first.");
      return;
    }

    setLoading(true);
    try {
      await requestPasswordReset({ email: normalizedEmail });
      navigate(`/auth/reset-password?email=${encodeURIComponent(normalizedEmail)}`);
    } catch (e) {
      setError((e as Error).message || "Unable to send OTP.");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <AuthFormLayout
        title="Forgot Password"
        subtitle="Enter your account email to receive a one-time OTP."
        variant="recovery"
      >
        <div className="loader-screen">
          <PrinterLoading />
        </div>
      </AuthFormLayout>
    );
  }

  return (
    <AuthFormLayout
      title="Forgot Password"
      subtitle="Enter your account email to receive a one-time OTP."
      variant="recovery"
    >
      <form onSubmit={onSubmit} className="form auth-form">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          type="email"
          autoComplete="email"
        />
        <button className="btn-primary" type="submit" disabled={loading}>
          Send OTP
        </button>
        {error ? <p className="error">{error}</p> : null}
        <Link to={`/auth/reset-password${email.trim() ? `?email=${encodeURIComponent(email.trim().toLowerCase())}` : ""}`}>
          Already have OTP?
        </Link>
      </form>
    </AuthFormLayout>
  );
}
