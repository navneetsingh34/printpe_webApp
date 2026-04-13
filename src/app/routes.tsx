import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "../features/auth/auth-context";
import { LoginPage } from "../features/auth/LoginPage";
import { RegisterPage } from "../features/auth/RegisterPage";
import { VerifyEmailPage } from "../features/auth/VerifyEmailPage";
import { ForgotPasswordPage } from "../features/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "../features/auth/ResetPasswordPage";
import { PublicFeedbackPage } from "../features/feedback/PublicFeedbackPage";
import { AppShell } from "../shared/ui/AppShell";
import { HomePage } from "../features/home/HomePage";
import { PrintPage } from "../features/print/PrintPage";
import { DocumentPreviewPage } from "../features/print/DocumentPreviewPage";
import { OrdersPage } from "../features/orders/OrdersPage";
import { OrderDetailsPage } from "../features/orders/OrderDetailsPage";
import { NotificationsPage } from "../features/notifications/NotificationsPage";
import { ProfilePage } from "../features/profile/ProfilePage";
import { PrinterLoading } from "../shared/ui/PrinterLoading";

function ProtectedLayout() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") {
    return (
      <div className="center-screen">
        <PrinterLoading />
      </div>
    );
  }
  if (status !== "signedIn") {
    const redirectPath = `${location.pathname}${location.search}${location.hash}`;
    const encodedRedirect = encodeURIComponent(redirectPath || "/");
    return <Navigate to={`/auth/login?redirect=${encodedRedirect}`} replace />;
  }
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
      <Route path="/feedback" element={<PublicFeedbackPage />} />

      <Route path="/" element={<ProtectedLayout />}>
        <Route index element={<HomePage />} />
        <Route path="print" element={<PrintPage />} />
        <Route path="print/preview" element={<DocumentPreviewPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="orders/:orderId" element={<OrderDetailsPage />} />
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
