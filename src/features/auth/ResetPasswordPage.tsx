import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "./auth-context";
import { AuthFormLayout } from "./AuthFormLayout";
import { PrinterLoading } from "../../shared/ui/PrinterLoading";

export function ResetPasswordPage() {
  const { confirmPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!email.trim() || !otp.trim() || !newPassword) {
      setError("All fields are required.");
      return;
    }
    if (otp.trim().length !== 6) {
      setError("OTP must be 6 digits.");
      return;
    }
    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const text = await confirmPasswordReset({
        email: email.trim().toLowerCase(),
        otp: otp.trim(),
        newPassword,
      });
      setMessage(text);
    } catch (e) {
      setError((e as Error).message || "Could not reset password.");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <AuthFormLayout title="Reset Password">
        <div className="loader-screen">
          <PrinterLoading />
        </div>
      </AuthFormLayout>
    );
  }

  return (
    <AuthFormLayout title="Reset Password">
      <form onSubmit={onSubmit} className="form">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          type="email"
          autoComplete="email"
        />
        <input
          value={otp}
          onChange={(e) => setOtp(e.target.value)}
          placeholder="OTP"
          maxLength={6}
        />
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="New password"
        />
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Confirm password"
        />
        <button className="btn-primary" type="submit" disabled={loading}>
          Reset Password
        </button>
        {message ? <p className="success">{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        <Link to="/auth/login">Back to login</Link>
      </form>
    </AuthFormLayout>
  );
}
