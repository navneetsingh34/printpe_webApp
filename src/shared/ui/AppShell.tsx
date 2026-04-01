import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../../features/auth/auth-context";
import { NotificationBellButton } from "./NotificationBellButton";

const tabs = [
  { to: "/", label: "Home" },
  { to: "/print", label: "Print" },
  { to: "/orders", label: "Orders" },
  { to: "/profile", label: "Profile" },
];

function renderTabIcon(path: string) {
  if (path === "/") {
    return (
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M3.8 10.6L12 4.2L20.2 10.6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M6.5 10.1V19.2H17.5V10.1"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M10 19.2V14.5H14V19.2"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (path === "/print") {
    return (
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect
          x="7.2"
          y="3.8"
          width="9.6"
          height="4.5"
          rx="1.2"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <rect
          x="4.9"
          y="8.4"
          width="14.2"
          height="8.2"
          rx="2.1"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <rect
          x="7.3"
          y="13.7"
          width="9.4"
          height="6.5"
          rx="1.3"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <path
          d="M8.8 16.3H15.2"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <circle cx="16.3" cy="11.1" r="0.9" fill="currentColor" />
      </svg>
    );
  }

  if (path === "/orders") {
    return (
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect
          x="5.3"
          y="4.6"
          width="13.4"
          height="14.8"
          rx="2.4"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <path
          d="M9 3.8V6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M15 3.8V6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M8.3 10H15.7"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path
          d="M8.3 13.2H15.7"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path
          d="M8.3 16.4H12.9"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle
        cx="12"
        cy="8.2"
        r="3.2"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M5.3 18.9C6.4 15.9 8.8 14.4 12 14.4C15.2 14.4 17.6 15.9 18.7 18.9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AppShell() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState("");
  const [scanResult, setScanResult] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!scannerOpen) return;

    let stream: MediaStream | null = null;
    let timer: number | null = null;
    let stopped = false;

    const DetectorCtor = (
      window as Window & {
        BarcodeDetector?: new (opts?: { formats?: string[] }) => {
          detect: (
            source: ImageBitmapSource,
          ) => Promise<Array<{ rawValue?: string }>>;
        };
      }
    ).BarcodeDetector;

    const startScanner = async () => {
      setScanError("");
      setScanResult("");
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
          },
          audio: false,
        });

        if (stopped || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        if (!DetectorCtor) {
          setScanError("QR scan is not supported in this browser.");
          return;
        }

        const detector = new DetectorCtor({ formats: ["qr_code"] });

        timer = window.setInterval(async () => {
          if (stopped || !videoRef.current || scanResult) return;
          if (videoRef.current.readyState < 2) return;

          try {
            const codes = await detector.detect(videoRef.current);
            const value = codes.find((entry) => entry.rawValue)?.rawValue;
            if (value) {
              setScanResult(value);
            }
          } catch {
            // Ignore transient detection errors while camera is active.
          }
        }, 400);
      } catch {
        setScanError(
          "Unable to access camera. Please allow camera permission.",
        );
      }
    };

    void startScanner();

    return () => {
      stopped = true;
      if (timer) window.clearInterval(timer);
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
      }
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [scannerOpen, scanResult]);

  return (
    <div className="app-shell">
      <header
        className={`app-header website-nav ${scrolled ? "website-nav--scrolled" : ""}`}
      >
        <div className="nav-left">
          <div className="brand-block">
            <span className="brand-chip">PQ</span>
            <div>
              <p className="brand-kicker">PRINTQ PLATFORM</p>
              <h1 className="brand-title">
                Print<span className="brand-highlight">Q</span>
              </h1>
              <p className="brand-subtitle">Hi {user?.firstName ?? "User"}</p>
            </div>
          </div>
        </div>

        <div className="nav-right">
          <nav className="desktop-nav">
            <div className="desktop-nav-track">
              {tabs.map((tab) => (
                <NavLink
                  key={`desktop-${tab.to}`}
                  to={tab.to}
                  end={tab.to === "/"}
                  className={({ isActive }) =>
                    isActive ? "nav-link active" : "nav-link"
                  }
                >
                  {tab.label}
                  <span className="nav-link-underline" />
                </NavLink>
              ))}
            </div>
            <button
              className="nav-link nav-link-btn nav-notification-btn"
              type="button"
              onClick={() => navigate("/notifications")}
            >
              Alerts
            </button>
          </nav>
          <div className="nav-user-pill" aria-label="Current user">
            <span className="nav-user-avatar">
              {(user?.firstName?.[0] ?? "U").toUpperCase()}
            </span>
            <span className="nav-user-name">{user?.firstName ?? "User"}</span>
          </div>
          <div className="mobile-action">
            <button
              type="button"
              className="scan-btn"
              onClick={() => setScannerOpen(true)}
              aria-label="Scan QR code"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M8 4H6.3C5.2 4 4.3 4.9 4.3 6V7.7"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M16 4H17.7C18.8 4 19.7 4.9 19.7 6V7.7"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M8 20H6.3C5.2 20 4.3 19.1 4.3 18V16.3"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M16 20H17.7C18.8 20 19.7 19.1 19.7 18V16.3"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <rect
                  x="8.2"
                  y="8.2"
                  width="3.1"
                  height="3.1"
                  rx="0.7"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <rect
                  x="12.7"
                  y="8.2"
                  width="3.1"
                  height="3.1"
                  rx="0.7"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <rect
                  x="8.2"
                  y="12.7"
                  width="3.1"
                  height="3.1"
                  rx="0.7"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <path
                  d="M13.5 13.4H16.3"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
                <path
                  d="M13.5 15.2H15.2"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <NotificationBellButton
              onClick={() => navigate("/notifications")}
            />
          </div>
        </div>
      </header>

      {scannerOpen ? (
        <div
          className="scan-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Scan QR code"
        >
          <article className="scan-modal-card">
            <div className="row">
              <h3>Scan QR</h3>
              <button
                type="button"
                className="btn-secondary btn-small"
                onClick={() => setScannerOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="scan-preview-wrap">
              <video
                ref={videoRef}
                className="scan-preview"
                playsInline
                muted
              />
              <div className="scan-frame" aria-hidden="true" />
            </div>

            {scanResult ? (
              <div className="scan-result-box">
                <p className="profile-label">Detected QR</p>
                <p className="scan-result-text">{scanResult}</p>
                <div className="row">
                  <button
                    type="button"
                    className="btn-secondary btn-small"
                    onClick={() => setScanResult("")}
                  >
                    Scan Again
                  </button>
                  <button
                    type="button"
                    className="btn-primary btn-small"
                    onClick={() =>
                      void navigator.clipboard?.writeText(scanResult)
                    }
                  >
                    Copy
                  </button>
                </div>
              </div>
            ) : null}

            {scanError ? <p className="error-message">{scanError}</p> : null}
          </article>
        </div>
      ) : null}

      <main className="app-content">
        <Outlet />
      </main>
      <nav className="tab-nav mobile-tab-nav">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === "/"}
            className={({ isActive }) => (isActive ? "tab active" : "tab")}
          >
            <span className="tab-icon" aria-hidden="true">
              {renderTabIcon(tab.to)}
            </span>
            <span className="tab-label">{tab.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
