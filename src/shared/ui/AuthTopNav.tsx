import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../features/auth/auth-context";

const authTabs = [
  { to: "/", label: "Home" },
  { to: "/orders", label: "Orders" },
  { to: "/auth/login", label: "Login" },
  { to: "/auth/register", label: "Sign up" },
];

export function AuthTopNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { status } = useAuth();
  const visibleTabs =
    status === "signedIn"
      ? authTabs
      : authTabs.filter(
          (tab) => tab.to === "/auth/login" || tab.to === "/auth/register",
        );

  return (
    <header className="app-header website-nav auth-top-nav">
      <div className="nav-left">
        <div className="brand-block">
          <span className="brand-chip" aria-hidden="true">
            PP
          </span>
          <div>
            <p className="brand-kicker">PRINTPE PLATFORM</p>
            <h1 className="brand-title">
              Print<span className="brand-highlight">Pe</span>
            </h1>
          </div>
        </div>
      </div>

      <nav className="auth-top-links" aria-label="Auth navigation">
        {visibleTabs.map((tab) => (
          <button
            key={tab.to}
            type="button"
            className={
              location.pathname === tab.to ||
              (tab.to !== "/" && location.pathname.startsWith(`${tab.to}/`))
                ? "nav-link active"
                : "nav-link"
            }
            onClick={() => navigate(tab.to)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </header>
  );
}
