import { FormEvent, KeyboardEvent, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "./auth-context";
import { AuthFormLayout } from "./AuthFormLayout";
import { PrinterLoading } from "../../shared/ui/PrinterLoading";
import { verifyResetOtp } from "../../services/api/authApi";

type ResetStep = "otp" | "password";

export function ResetPasswordPage() {
  const { confirmPasswordReset } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [otpDigits, setOtpDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [step, setStep] = useState<ResetStep>("otp");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const otp = useMemo(() => otpDigits.join(""), [otpDigits]);

  const updateOtpAt = (index: number, nextValue: string) => {
    const onlyDigits = nextValue.replace(/\D/g, "");
    setOtpDigits((previous) => {
      const updated = [...previous];

      if (onlyDigits.length > 1) {
        const spread = onlyDigits.slice(0, 6 - index).split("");
        spread.forEach((digit, offset) => {
          updated[index + offset] = digit;
        });
      } else {
        updated[index] = onlyDigits;
      }

      return updated;
    });

    if (!onlyDigits) {
      return;
    }

    const nextIndex = Math.min(index + onlyDigits.length, 5);
    otpRefs.current[nextIndex]?.focus();
  };

  const onOtpKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
    if (event.key === "ArrowLeft" && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
    if (event.key === "ArrowRight" && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const onVerifyOtp = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!email.trim()) {
      setError("Email is required.");
      return;
    }

    if (otp.length !== 6) {
      setError("Enter the 6-digit OTP.");
      return;
    }

    setLoading(true);
    try {
      await verifyResetOtp({ email: email.trim().toLowerCase(), otp });
      setStep("password");
    } catch (e) {
      setError((e as Error).message || "Invalid OTP. Please check and try again.");
    } finally {
      setLoading(false);
    }
  };

  const onResetPassword = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || otp.length !== 6 || !newPassword) {
      setError("All fields are required.");
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
        email: normalizedEmail,
        otp,
        newPassword,
      });
      setMessage(text || "Password reset successful.");
      setTimeout(() => {
        navigate("/auth/login");
      }, 1200);
    } catch (e) {
      setStep("otp");
      setError((e as Error).message || "Could not reset password.");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <AuthFormLayout
        title={step === "otp" ? "Verify OTP" : "Set New Password"}
        subtitle={
          step === "otp"
            ? "Enter the 6-digit code sent to your email."
            : "Create a new password for your account."
        }
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
      title={step === "otp" ? "Verify OTP" : "Set New Password"}
      subtitle={
        step === "otp"
          ? "Enter the 6-digit code sent to your email."
          : "Create a new password for your account."
      }
      variant="recovery"
    >
      {step === "otp" ? (
        <form onSubmit={onVerifyOtp} className="form auth-form">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            type="email"
            autoComplete="email"
          />
          <div className="otp-input-row" aria-label="OTP input">
            {otpDigits.map((digit, index) => (
              <input
                key={index}
                ref={(element) => {
                  otpRefs.current[index] = element;
                }}
                className="otp-digit-input"
                value={digit}
                onChange={(e) => updateOtpAt(index, e.target.value)}
                onKeyDown={(e) => onOtpKeyDown(index, e)}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={1}
                aria-label={`OTP digit ${index + 1}`}
              />
            ))}
          </div>
          <button className="btn-primary" type="submit" disabled={loading}>
            Verify OTP
          </button>
          {error ? <p className="error">{error}</p> : null}
          <p className="auth-footnote">
            Didn&apos;t receive it? <Link to={`/auth/forgot-password?email=${encodeURIComponent(email.trim())}`}>Resend OTP</Link>
          </p>
        </form>
      ) : (
        <form onSubmit={onResetPassword} className="form auth-form">
          <p className="auth-google-note">
            OTP verified for <strong>{email.trim().toLowerCase()}</strong>
          </p>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password"
            autoComplete="new-password"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm password"
            autoComplete="new-password"
          />
          <button className="btn-primary" type="submit" disabled={loading}>
            Set New Password
          </button>
          {message ? <p className="success">{message}</p> : null}
          {error ? <p className="error">{error}</p> : null}
          <p className="auth-footnote">
            Wrong code? <button type="button" className="inline-link-button" onClick={() => setStep("otp")}>Edit OTP</button>
          </p>
        </form>
      )}
    </AuthFormLayout>
  );
}
