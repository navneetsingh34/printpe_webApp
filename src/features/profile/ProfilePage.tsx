import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  requestEmailOtp,
  updateMe,
  verifyEmailOtp,
} from "../../services/api/usersApi";
import { useAuth } from "../auth/auth-context";

export function ProfilePage() {
  const { user, signOut, refreshProfile } = useAuth();
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [emailOtp, setEmailOtp] = useState("");
  const [emailOtpRequestedFor, setEmailOtpRequestedFor] = useState("");
  const [requestingEmailOtp, setRequestingEmailOtp] = useState(false);
  const [verifyingEmailOtp, setVerifyingEmailOtp] = useState(false);
  const [emailVerified, setEmailVerified] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setFirstName(user?.firstName ?? "");
    setLastName(user?.lastName ?? "");
    setEmail(user?.email ?? "");
    setEmailOtp("");
    setEmailOtpRequestedFor("");
    setEmailVerified(true);
  }, [user]);

  const fullName = useMemo(
    () => [firstName, lastName].filter(Boolean).join(" "),
    [firstName, lastName],
  );
  const initials =
    fullName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "U";
  const role = user?.role ?? "user";

  const normalizedCurrentEmail = (user?.email ?? "").trim().toLowerCase();
  const normalizedDraftEmail = email.trim().toLowerCase();
  const emailChanged = normalizedDraftEmail !== normalizedCurrentEmail;

  const canSave = !emailChanged || emailVerified;

  const requestEmailVerification = async () => {
    setError("");
    setMessage("");

    if (!normalizedDraftEmail) {
      setError("Email is required.");
      return;
    }

    if (!emailChanged) {
      setError("Enter a new email address first.");
      return;
    }

    setRequestingEmailOtp(true);
    try {
      const response = await requestEmailOtp({ email: normalizedDraftEmail });
      setEmailOtpRequestedFor(normalizedDraftEmail);
      setEmailOtp("");
      setEmailVerified(false);
      setMessage(response.message || "OTP sent to your email address.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to send email OTP.",
      );
    } finally {
      setRequestingEmailOtp(false);
    }
  };

  const confirmEmailVerification = async () => {
    setError("");
    setMessage("");

    if (emailOtpRequestedFor !== normalizedDraftEmail) {
      setError("Request an OTP for the current email first.");
      return;
    }

    if (emailOtp.trim().length < 4) {
      setError("Enter the OTP sent to your email.");
      return;
    }

    setVerifyingEmailOtp(true);
    try {
      const response = await verifyEmailOtp({
        email: normalizedDraftEmail,
        otp: emailOtp.trim(),
      });
      await refreshProfile();
      setEmail(response.email);
      setEmailOtpRequestedFor("");
      setEmailOtp("");
      setEmailVerified(true);
      setMessage(
        response.message || "Email verified successfully. You can save now.",
      );
    } catch (verifyError) {
      setError(
        verifyError instanceof Error
          ? verifyError.message
          : "Unable to verify email.",
      );
    } finally {
      setVerifyingEmailOtp(false);
    }
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");

    const nextFirstName = firstName.trim();
    const nextLastName = lastName.trim();
    const nextEmail = normalizedDraftEmail;

    if (!nextFirstName || !nextLastName) {
      setError("First and last name are required.");
      return;
    }

    if (!nextEmail) {
      setError("Email is required.");
      return;
    }

    if (emailChanged && !emailVerified) {
      setError("Verify the new email address before saving changes.");
      return;
    }

    setSaving(true);
    try {
      const nextMessages: string[] = [];

      if (
        nextFirstName !== (user?.firstName ?? "") ||
        nextLastName !== (user?.lastName ?? "")
      ) {
        await updateMe({
          firstName: nextFirstName,
          lastName: nextLastName,
        });

        await refreshProfile();
        nextMessages.push("Profile updated successfully.");
      }

      if (
        nextFirstName === (user?.firstName ?? "") &&
        nextLastName === (user?.lastName ?? "")
      ) {
        nextMessages.push("No changes to save.");
      }

      if (nextMessages.length > 0) {
        setMessage(nextMessages.join(" "));
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="page-animate profile-page">
      <div className="row profile-header-row">
        <div className="profile-header-copy">
          <p className="profile-kicker">Account Center</p>
        </div>
      </div>

      <article className="card profile-hero-card animate-rise">
        <div className="profile-avatar" aria-hidden="true">
          {initials}
        </div>
        <div className="profile-hero-copy">
          <p className="profile-label">Signed in as</p>
          <h3>{fullName || "User"}</h3>
          <p className="profile-email">{user?.email ?? "-"}</p>
        </div>
        <span className="profile-role-pill">{role}</span>
      </article>

      <article className="card profile-details-card animate-rise delay-1">
        <form className="profile-form" onSubmit={saveProfile}>
          <div className="profile-details-grid">
            <label className="profile-field">
              <span className="profile-label">First name</span>
              <input
                className="profile-input"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                autoComplete="given-name"
              />
            </label>

            <label className="profile-field">
              <span className="profile-label">Last name</span>
              <input
                className="profile-input"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                autoComplete="family-name"
              />
            </label>

            <label className="profile-field">
              <span className="profile-label">Email</span>
              <div className="profile-input-shell">
                <input
                  className="profile-input profile-input--action"
                  type="email"
                  value={email}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setEmail(nextValue);

                    const nextNormalized = nextValue.trim().toLowerCase();
                    setEmailVerified(nextNormalized === normalizedCurrentEmail);
                    if (nextNormalized !== emailOtpRequestedFor) {
                      setEmailOtpRequestedFor("");
                      setEmailOtp("");
                    }
                  }}
                  autoComplete="email"
                />
                <button
                  type="button"
                  className="profile-input-action-btn"
                  onClick={() => void requestEmailVerification()}
                  disabled={requestingEmailOtp || !emailChanged}
                >
                  {requestingEmailOtp
                    ? "Sending..."
                    : emailOtpRequestedFor === normalizedDraftEmail
                    ? "Resend"
                    : "Verify"}
                </button>
              </div>
            </label>

            <div className="profile-field">
              <p className="profile-label">Role</p>
              <p className="profile-value profile-role-text">{role}</p>
            </div>

            <div className="profile-field profile-readonly-field">
              <p className="profile-label">Verification status</p>
              <p className="profile-value profile-status-text">
                {emailChanged
                  ? emailOtpRequestedFor === normalizedDraftEmail
                    ? "Email OTP sent"
                    : "Email change pending verification"
                  : emailVerified
                  ? "Email verified"
                  : "Email not set"}
              </p>
            </div>
          </div>

          {emailChanged && emailOtpRequestedFor === normalizedDraftEmail ? (
            <div className="profile-otp-card">
              <p className="profile-label">Verify email</p>
              <div className="otp-input-row">
                <input
                  className="otp-digit-input profile-otp-input"
                  value={emailOtp}
                  onChange={(event) =>
                    setEmailOtp(event.target.value.replace(/\D/g, ""))
                  }
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="Enter OTP"
                />
              </div>
              <div className="profile-inline-actions">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void confirmEmailVerification()}
                  disabled={verifyingEmailOtp}
                >
                  {verifyingEmailOtp ? "Verifying..." : "Confirm OTP"}
                </button>
              </div>
            </div>
          ) : null}

          <p className="profile-note">
            Keep your details updated so print shops can contact you quickly for urgent jobs.
          </p>

          {message ? <p className="profile-success-text">{message}</p> : null}
          {error ? <p className="profile-error-text">{error}</p> : null}

          <div className="profile-actions profile-actions--split">
            <button
              className="btn-primary profile-signout-btn"
              type="submit"
              disabled={saving || !canSave}
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
            <button
              className="btn-secondary profile-signout-btn"
              type="button"
              onClick={() => void signOut()}
            >
              Sign out
            </button>
          </div>
        </form>
      </article>
    </section>
  );
}
