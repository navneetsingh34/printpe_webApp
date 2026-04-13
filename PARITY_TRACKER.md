# PrintPe WebApp Parity Tracker

This tracker maps PrintPe_App parity against PrintPe_WebApp and marks what is done, partially done, or pending.

## 1) Architecture and Core Setup

- Status: Done
- Scope completed:
  - Vite + React + TypeScript app baseline
  - Feature-first structure (app/features/shared/services)
  - Auth-gated routes and app shell
  - Environment config and token storage
- Evidence:
  - src/app/routes.tsx
  - src/app/providers.tsx
  - src/services/api/env.ts
  - src/services/storage/tokenStorage.ts

## 2) HTTP Layer (No Axios)

- Status: Done
- Scope completed:
  - Fetch-only client with auth headers, timeout and error handling
  - Domain API modules for auth, shops, orders, notifications, print flow
- Evidence:
  - src/services/api/httpClient.ts
  - src/services/api/authApi.ts
  - src/services/api/shopsApi.ts
  - src/services/api/ordersApi.ts
  - src/services/api/notificationsApi.ts
  - src/services/api/printFlowApi.ts
- Constraint:
  - No Axios in code or dependencies

## 3) Auth Flows Parity

- Status: Done
- Scope completed:
  - Login, Register, Forgot Password, Reset Password pages
  - Required field validation and error messages
  - Password and OTP validation behaviors
  - Loading states and normalized email handling
- Evidence:
  - src/features/auth/LoginPage.tsx
  - src/features/auth/RegisterPage.tsx
  - src/features/auth/ForgotPasswordPage.tsx
  - src/features/auth/ResetPasswordPage.tsx
  - src/features/auth/auth-context.tsx
- Remaining:
  - None (optional future visual-only refinements)

## 4) Home + Shop Status Parity

- Status: Done (functional parity), Partial (minor UX polish)
- Scope completed:
  - All Shops / Near Me modes
  - Search and geolocation-based nearby list
  - Shop status live updates via socket snapshot + delta events
  - Offline shop selection blocked
  - Distance display and fallback polling
- Evidence:
  - src/features/home/HomePage.tsx
  - src/services/realtime/shopStatusSocket.ts
- Remaining:
  - Optional manual refresh control and richer shop card metadata parity

## 5) Print Flow Parity

- Status: Done (core parity), Partial (advanced payment parity)
- Scope completed:
  - Step flow: intro -> upload -> configure -> payment
  - Upload validation (type/size)
  - Pricing normalization + fallback pricing
  - Estimate breakdown (tier, discount, binding, total)
  - Uploaded file ID usage in create job payload
- Evidence:
  - src/features/print/PrintPage.tsx
- Remaining:
  - Razorpay-like web checkout parity (if required for web scope)
  - Upload progress UX and retry affordances

## 6) Orders Parity

- Status: Done (functional parity), Partial (advanced live ETA enrichment)
- Scope completed:
  - Orders fetch + queue enrichment
  - Realtime order update listeners
  - Timeline status UI and active order indicator
  - Background sync without full loading flicker
- Evidence:
  - src/features/orders/OrdersPage.tsx
  - src/services/realtime/orderTrackingSocket.ts
- Remaining:
  - Fine-grained event-to-ETA mapping if backend emits estimated minutes explicitly

## 7) Notifications Parity

- Status: Done
- Scope completed:
  - Notifications list + mark all read
  - Mark single item read
  - Realtime in-app alert banner
  - Socket connection status chip
  - Queue update synthetic notification entries
- Evidence:
  - src/features/notifications/NotificationsPage.tsx
  - src/services/realtime/notificationsSocket.ts
- Remaining:
  - None

## 8) Profile Parity

- Status: Done
- Scope completed:
  - Labeled profile fields
  - Notification bell in profile header
  - Sign out action
- Evidence:
  - src/features/profile/ProfilePage.tsx

## 9) Navigation and Responsive UX

- Status: Done
- Scope completed:
  - Desktop website-style top nav
  - Mobile app-style bottom nav
  - Shared app shell behavior
- Evidence:
  - src/shared/ui/AppShell.tsx
  - src/index.css
- Notes:
  - UI freeze cleanup completed: deduplicated stylesheet and retained animation behavior.

## 10) Quality Gates

- Status: Done
- Scope completed:
  - lint and build passing after each major phase
  - tests for API error type and auth context
  - tests for print validation flow
  - tests for orders load + queue rendering
  - tests for notifications mark-read behavior
- Evidence:
  - src/services/api/httpClient.test.ts
  - src/features/auth/auth-context.test.tsx
  - src/features/print/PrintPage.test.tsx
  - src/features/orders/OrdersPage.test.tsx
  - src/features/notifications/NotificationsPage.test.tsx
- Remaining:
  - Optional broader integration/e2e tests (not required for current parity target)

## Final Remaining Work (Priority Order)

1. Optional payment-flow web parity (only if web product requires equivalent online checkout).
2. Optional full e2e automation for deployment confidence.

## Current Verdict

- Core functionality parity: Achieved.
- Realtime parity: Achieved with practical web adaptations.
- UX parity: Achieved for current scope, with optional future refinements.
- Axios constraint: Fully respected (fetch-only).
