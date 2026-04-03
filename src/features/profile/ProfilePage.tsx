import { FormEvent, useEffect, useMemo, useState } from "react";
import { updateMe } from "../../services/api/usersApi";
import { useAuth } from "../auth/auth-context";

export function ProfilePage() {
  const { user, signOut, refreshProfile } = useAuth();
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setFirstName(user?.firstName ?? "");
    setLastName(user?.lastName ?? "");
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

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");

    const nextFirstName = firstName.trim();
    const nextLastName = lastName.trim();

    if (!nextFirstName || !nextLastName) {
      setError("First and last name are required.");
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
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to update profile.",
      );
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
              <input
                className="profile-input"
                type="email"
                value={user?.email ?? ""}
                autoComplete="email"
                readOnly
                disabled
              />
            </label>
          </div>

          <p className="profile-note">
            Keep your details updated so print shops can contact you quickly for
            urgent jobs.
          </p>

          {message ? <p className="profile-success-text">{message}</p> : null}
          {error ? <p className="profile-error-text">{error}</p> : null}

          <div className="profile-actions profile-actions--split">
            <button
              className="btn-primary profile-signout-btn"
              type="submit"
              disabled={saving}
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
