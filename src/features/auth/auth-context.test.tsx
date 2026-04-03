import { render, screen } from "@testing-library/react";
import { AuthProvider, useAuth } from "./auth-context";
import { googleLogin } from "../../services/api/authApi";
import { setTokenBundle } from "../../services/storage/tokenStorage";

vi.mock("../../services/api/authApi", () => ({
  getMe: vi.fn().mockResolvedValue({ id: "1", email: "a@b.com" }),
  login: vi.fn(),
  googleLogin: vi.fn(),
  registerWithGoogle: vi.fn(),
  register: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
}));

vi.mock("../../services/storage/tokenStorage", () => ({
  getTokenBundle: vi.fn().mockResolvedValue(null),
  setTokenBundle: vi.fn(),
  clearTokenBundle: vi.fn(),
}));

function StatusProbe() {
  const { status } = useAuth();
  return <div>{status}</div>;
}

function GoogleSignInProbe() {
  const { signInWithGoogle, status } = useAuth();
  return (
    <>
      <button
        type="button"
        onClick={() => void signInWithGoogle({ idToken: "google-id-token" })}
      >
        Sign in with Google
      </button>
      <div data-testid="google-status">{status}</div>
    </>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts signedOut when no token exists", async () => {
    render(
      <AuthProvider>
        <StatusProbe />
      </AuthProvider>,
    );
    expect(await screen.findByText("signedOut")).toBeInTheDocument();
  });

  it("signs in with google and stores auth tokens", async () => {
    vi.mocked(googleLogin).mockResolvedValue({
      user: { id: "google-1", email: "google@printpe.com" },
      accessToken: "access-token",
      refreshToken: "refresh-token",
    });

    render(
      <AuthProvider>
        <GoogleSignInProbe />
      </AuthProvider>,
    );

    const button = await screen.findByRole("button", {
      name: "Sign in with Google",
    });
    button.click();

    expect(await screen.findByText("signedIn")).toBeInTheDocument();
    expect(googleLogin).toHaveBeenCalledWith({ idToken: "google-id-token" });
    expect(setTokenBundle).toHaveBeenCalledWith({
      accessToken: "access-token",
      refreshToken: "refresh-token",
    });
  });
});
