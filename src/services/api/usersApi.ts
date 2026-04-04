import { apiRequest } from "./httpClient";
import { AuthUser } from "../../shared/types/auth";

export type UpdateMeInput = {
  firstName?: string;
  lastName?: string;
  email?: string;
  avatar?: string;
};

export function updateMe(input: UpdateMeInput): Promise<AuthUser> {
  return apiRequest("/users/me", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
