import { apiRequest } from "./httpClient";
import {
  AuthResponse,
  AuthUser,
  ForgotPasswordInput,
  GoogleLoginInput,
  GoogleRegisterInput,
  LoginInput,
  RegisterResponse,
  RegisterInput,
  ResetPasswordInput,
  VerifyEmailInput,
} from "../../shared/types/auth";

export function login(input: LoginInput): Promise<AuthResponse> {
  return apiRequest(
    "/auth/login",
    { method: "POST", body: JSON.stringify(input) },
    { auth: false },
  );
}

export function googleLogin(input: GoogleLoginInput): Promise<AuthResponse> {
  return apiRequest(
    "/auth/google",
    { method: "POST", body: JSON.stringify(input) },
    { auth: false },
  );
}

export function registerWithGoogle(
  input: GoogleRegisterInput,
): Promise<AuthResponse> {
  return apiRequest(
    "/auth/register/google",
    { method: "POST", body: JSON.stringify(input) },
    { auth: false },
  );
}

export function register(input: RegisterInput): Promise<RegisterResponse> {
  return apiRequest(
    "/auth/register",
    {
      method: "POST",
      body: JSON.stringify({ ...input, role: input.role ?? "user" }),
    },
    { auth: false },
  ) as Promise<RegisterResponse>;
}

export function verifyEmail(
  input: VerifyEmailInput,
): Promise<{ message: string }> {
  return apiRequest(
    "/auth/verify-email",
    { method: "POST", body: JSON.stringify(input) },
    { auth: false },
  );
}

export function resendOtp(input: {
  email: string;
}): Promise<{ message: string }> {
  return apiRequest(
    "/auth/resend-otp",
    { method: "POST", body: JSON.stringify(input) },
    { auth: false },
  );
}

export function forgotPassword(
  input: ForgotPasswordInput,
): Promise<{ message: string }> {
  return apiRequest(
    "/auth/forgot-password",
    { method: "POST", body: JSON.stringify(input) },
    { auth: false },
  );
}

export function resetPassword(
  input: ResetPasswordInput,
): Promise<{ message: string }> {
  return apiRequest(
    "/auth/reset-password",
    { method: "POST", body: JSON.stringify(input) },
    { auth: false },
  );
}

export function verifyResetOtp(input: {
  email: string;
  otp: string;
}): Promise<{ message: string }> {
  return apiRequest(
    "/auth/verify-reset-otp",
    { method: "POST", body: JSON.stringify(input) },
    { auth: false },
  );
}

export function getMe(): Promise<AuthUser> {
  return apiRequest("/auth/me", { method: "GET" });
}
