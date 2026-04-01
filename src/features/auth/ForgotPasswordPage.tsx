import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "./auth-context";
import { AuthFormLayout } from "./AuthFormLayout";
import { PrinterLoading } from "../../shared/ui/PrinterLoading";

export function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    setError("");

    if (!email.trim()) {
      setError("Enter your email first.");
      return;
    }

    setLoading(true);
    try {
      const text = await requestPasswordReset({
        email: email.trim().toLowerCase(),
      });
      setMessage(text);
    } catch (e) {
      setError((e as Error).message || "Unable to send OTP.");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <AuthFormLayout title="Forgot Password">
        <div className="loader-screen">
          <PrinterLoading />
        </div>
      </AuthFormLayout>
    );
  }

  return (
    <AuthFormLayout title="Forgot Password">
      <form onSubmit={onSubmit} className="form">
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
        {message ? <p className="success">{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        <Link to="/auth/reset-password">Already have OTP?</Link>
      </form>
    </AuthFormLayout>
  );
}
