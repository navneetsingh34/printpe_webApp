import { apiRequest } from "./httpClient";
import { AuthUser } from "../../shared/types/auth";

export type UpdateMeInput = {
  firstName?: string;
  lastName?: string;
  email?: string;
  avatar?: string;
};

export type EmailOtpResponse = {
  success: boolean;
  email: string;
  expiresInSeconds: number;
  message: string;
};

export function updateMe(input: UpdateMeInput): Promise<AuthUser> {
  return apiRequest("/users/me", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function requestEmailOtp(input: {
  email: string;
}): Promise<EmailOtpResponse> {
  return apiRequest("/users/me/email-verification/request-otp", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function verifyEmailOtp(input: {
  email: string;
  otp: string;
}): Promise<{ success: boolean; message: string; email: string }> {
  return apiRequest("/users/me/email-verification/verify-otp", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
