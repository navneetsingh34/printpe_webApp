import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "../features/auth/auth-context";
import { LoginPage } from "../features/auth/LoginPage";
import { RegisterPage } from "../features/auth/RegisterPage";
import { VerifyEmailPage } from "../features/auth/VerifyEmailPage";
import { ForgotPasswordPage } from "../features/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "../features/auth/ResetPasswordPage";
import { AppShell } from "../shared/ui/AppShell";
import { HomePage } from "../features/home/HomePage";
import { PrintPage } from "../features/print/PrintPage";
import { DocumentPreviewPage } from "../features/print/DocumentPreviewPage";
import { OrdersPage } from "../features/orders/OrdersPage";
import { NotificationsPage } from "../features/notifications/NotificationsPage";
import { ProfilePage } from "../features/profile/ProfilePage";
import { PrinterLoading } from "../shared/ui/PrinterLoading";

function ProtectedLayout() {
  const { status } = useAuth();
  if (status === "loading") {
    return (
      <div className="center-screen">
        <PrinterLoading />
      </div>
    );
  }
  if (status !== "signedIn") return <Navigate to="/auth/login" replace />;
  return <AppShell />;
}

export function AppRoutes() {
  const { status } = useAuth();

  return (
    <Routes>
      <Route
        path="/auth/login"
        element={
          status === "signedIn" ? <Navigate to="/" replace /> : <LoginPage />
        }
      />
      <Route
        path="/auth/register"
        element={
          status === "signedIn" ? <Navigate to="/" replace /> : <RegisterPage />
        }
      />
      <Route path="/auth/verify-email" element={<VerifyEmailPage />} />
      <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/auth/reset-password" element={<ResetPasswordPage />} />

      <Route path="/" element={<ProtectedLayout />}>
        <Route index element={<HomePage />} />
        <Route path="print" element={<PrintPage />} />
        <Route path="print/preview" element={<DocumentPreviewPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>

      <Route
        path="*"
        element={
          <Navigate to={status === "signedIn" ? "/" : "/auth/login"} replace />
        }
      />
    </Routes>
  );
}
