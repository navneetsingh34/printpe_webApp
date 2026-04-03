import { FormEvent, KeyboardEvent, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AuthFormLayout } from "./AuthFormLayout";
import { PrinterLoading } from "../../shared/ui/PrinterLoading";
import { resendOtp, verifyEmail } from "../../services/api/authApi";

export function VerifyEmailPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [otpDigits, setOtpDigits] = useState<string[]>([
    "",
    "",
    "",
    "",
    "",
    "",
  ]);
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

  const onOtpKeyDown = (
    index: number,
    event: KeyboardEvent<HTMLInputElement>,
  ) => {
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

  const onVerify = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Email is required.");
      return;
    }

    if (otp.length !== 6) {
      setError("Enter the 6-digit OTP.");
      return;
    }

    setLoading(true);
    try {
      const response = await verifyEmail({ email: normalizedEmail, otp });
      setMessage(response.message || "Email verified successfully.");
      setTimeout(() => {
        navigate("/auth/login");
      }, 1200);
    } catch (e) {
      setError(
        (e as Error).message || "Invalid OTP. Please check and try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  const onResend = async () => {
    setError("");
    setMessage("");

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Email is required.");
      return;
    }

    setLoading(true);
    try {
      const response = await resendOtp({ email: normalizedEmail });
      setMessage(response.message || "A new OTP has been sent.");
    } catch (e) {
      setError((e as Error).message || "Unable to resend OTP.");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <AuthFormLayout
        title="Verify Email"
        subtitle="Enter the 6-digit code sent to your email address."
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
      title="Verify Email"
      subtitle="Enter the 6-digit code sent to your email address."
      variant="recovery"
    >
      <form onSubmit={onVerify} className="form auth-form">
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
          Verify Email
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={onResend}
          disabled={loading}
        >
          Resend OTP
        </button>
        {message ? <p className="success">{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        <p className="auth-footnote">
          Already verified? <Link to="/auth/login">Continue to login</Link>
        </p>
      </form>
    </AuthFormLayout>
  );
}
