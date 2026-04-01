import { ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

export function AuthFormLayout({ title, subtitle, children }: Props) {
  return (
    <div className="auth-page page-animate auth-scene">
      <aside className="auth-brand-panel animate-rise">
        <div className="auth-brand-badge">
          <span className="brand-chip auth-brand-chip">PP</span>
          <div>
            <p className="auth-brand-kicker">PRINTPE PLATFORM</p>
            <h2>PrintPe</h2>
          </div>
        </div>

        <p className="auth-brand-copy">
          Clean sign in and sign up flows for quick access to your print jobs,
          orders, and scanner tools.
        </p>

        <div className="auth-feature-stack">
          <div className="auth-feature-card">
            <span className="auth-feature-icon">⚡</span>
            <div>
              <strong>Fast access</strong>
              <p>Jump back into your dashboard in seconds.</p>
            </div>
          </div>
          <div className="auth-feature-card">
            <span className="auth-feature-icon">🔒</span>
            <div>
              <strong>Secure account</strong>
              <p>Keep your print history and profile data private.</p>
            </div>
          </div>
          <div className="auth-feature-card">
            <span className="auth-feature-icon">📱</span>
            <div>
              <strong>Mobile ready</strong>
              <p>Designed to feel smooth on small phone screens.</p>
            </div>
          </div>
        </div>
      </aside>

      <section className="card auth-card animate-rise">
        <div className="auth-card-topline">
          <span className="auth-card-pill">Secure access</span>
          <span className="auth-card-note">One account for everything</span>
        </div>
        <h2>{title}</h2>
        {subtitle ? <p className="auth-card-subtitle">{subtitle}</p> : null}
        {children}
      </section>
    </div>
  );
}
