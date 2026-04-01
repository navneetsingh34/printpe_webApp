import { ReactNode } from "react";

type Props = {
  title: string;
  children: ReactNode;
};

export function AuthFormLayout({ title, children }: Props) {
  return (
    <div className="auth-page page-animate auth-scene">
      <div className="card auth-card animate-rise">
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
