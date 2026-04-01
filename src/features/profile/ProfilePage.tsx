import { useAuth } from "../auth/auth-context";

export function ProfilePage() {
  const { user, signOut } = useAuth();
  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ");
  const initials =
    fullName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "U";
  const role = user?.role ?? "user";

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
        <div className="profile-details-grid">
          <div className="profile-field">
            <p className="profile-label">Name</p>
            <p className="profile-value">{fullName || "-"}</p>
          </div>

          <div className="profile-field">
            <p className="profile-label">Email</p>
            <p className="profile-value">{user?.email ?? "-"}</p>
          </div>

          <div className="profile-field">
            <p className="profile-label">Phone</p>
            <p className="profile-value">{user?.phone ?? "-"}</p>
          </div>

          <div className="profile-field">
            <p className="profile-label">Role</p>
            <p className="profile-value profile-role-text">{role}</p>
          </div>
        </div>

        <p className="profile-note">
          Keep your details updated so print shops can contact you quickly for
          urgent jobs.
        </p>

        <div className="profile-actions">
          <button
            className="btn-primary profile-signout-btn"
            type="button"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      </article>
    </section>
  );
}
