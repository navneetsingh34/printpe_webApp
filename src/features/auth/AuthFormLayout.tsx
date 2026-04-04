import { ReactNode } from "react";
import { AuthTopNav } from "../../shared/ui/AuthTopNav";

type Props = {
  title: string;
  subtitle?: string;
  variant?: "default" | "login" | "signup" | "recovery";
  children: ReactNode;
};

export function AuthFormLayout({
  title,
  subtitle,
  variant = "default",
  children,
}: Props) {
  return (
    <div className="auth-single-wrap page-animate">
      <AuthTopNav />
      <section
        className={`auth-card auth-card-single auth-card-single--${variant} animate-rise`}
      >
        <div className="auth-form-pane">
          <div className="auth-header">
            <p className="section-kicker">PRINTPE PLATFORM</p>
            <h1>{title}</h1>
            {subtitle ? <p className="auth-helper">{subtitle}</p> : null}
          </div>
          {children}
        </div>
      </section>
    </div>
  );
}
