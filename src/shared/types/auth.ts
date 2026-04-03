export type TokenBundle = {
  accessToken: string;
  refreshToken: string;
};

export type AuthUser = {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  role?: string;
};

export type LoginInput = { email: string; password: string };
export type GoogleLoginInput = { idToken: string };
export type GoogleRegisterInput = { idToken: string; acceptedTerms: boolean };
export type RegisterResponse = {
  user: AuthUser;
  message: string;
  otpRequired: boolean;
};
export type RegisterInput = {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role?: "user" | "shop_owner" | "admin";
  acceptedTerms: boolean;
};
export type VerifyEmailInput = { email: string; otp: string };
export type ForgotPasswordInput = { email: string };
export type ResetPasswordInput = {
  email: string;
  otp: string;
  newPassword: string;
};

export type AuthResponse = {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
};
