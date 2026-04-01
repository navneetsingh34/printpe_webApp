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
export type RegisterInput = {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role?: 'user' | 'shop_owner' | 'admin';
};
export type ForgotPasswordInput = { email: string };
export type ResetPasswordInput = { email: string; otp: string; newPassword: string };

export type AuthResponse = {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
};
