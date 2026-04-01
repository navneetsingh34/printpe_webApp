import { useEffect, useState } from "react";

type PrinterLoadingProps = {
  showDelayMessage?: boolean;
};

export function PrinterLoading({
  showDelayMessage = true,
}: PrinterLoadingProps) {
  const [showSlowMessage, setShowSlowMessage] = useState(false);

  useEffect(() => {
    if (!showDelayMessage) return;
    setShowSlowMessage(false);
    const timer = window.setTimeout(() => {
      setShowSlowMessage(true);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [showDelayMessage]);

  return (
    <div className="printer-loading-state" role="status" aria-live="polite">
      <div className="hero-printer-animation">
        <svg
          className="hero-printer-svg"
          width="240"
          height="240"
          viewBox="0 0 200 200"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <defs>
            <linearGradient
              id="printerPaperAccent"
              x1="75"
              y1="120"
              x2="130"
              y2="120"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#FB8D34" />
              <stop offset="1" stopColor="#FFC665" />
            </linearGradient>
            <linearGradient
              id="printerButtonAccent"
              x1="125"
              y1="113"
              x2="140"
              y2="113"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#FB8D34" />
              <stop offset="1" stopColor="#E67E28" />
            </linearGradient>
          </defs>

          <ellipse
            className="printer-shadow"
            cx="100"
            cy="170"
            rx="60"
            ry="10"
            fill="#F6E6D7"
          />

          <g className="paper-group">
            <rect
              x="60"
              y="70"
              width="80"
              height="100"
              rx="4"
              fill="#FFFFFF"
              stroke="#E8D7C6"
              strokeWidth="1"
            />
            <rect x="75" y="90" width="50" height="4" rx="2" fill="#F3F4F6" />
            <rect x="75" y="105" width="50" height="4" rx="2" fill="#F3F4F6" />
            <rect
              x="75"
              y="120"
              width="30"
              height="4"
              rx="2"
              fill="url(#printerPaperAccent)"
              opacity="0.85"
            />
            <rect
              className="paper-scan"
              x="73"
              y="82"
              width="54"
              height="3"
              rx="2"
              fill="#FB8D34"
              opacity="0.75"
            />
          </g>

          <rect x="50" y="60" width="100" height="40" rx="8" fill="#FFF8F0" />
          <rect x="50" y="85" width="100" height="15" fill="#F7EDE2" />
          <rect
            className="printer-feed-light"
            x="56"
            y="88"
            width="88"
            height="3"
            rx="2"
            fill="#FB8D34"
            opacity="0.35"
          />

          <rect
            className="printer-body"
            x="40"
            y="90"
            width="120"
            height="60"
            rx="12"
            fill="#FFFFFF"
          />
          <rect
            x="40"
            y="90"
            width="120"
            height="60"
            rx="12"
            stroke="#E7D8C8"
            strokeWidth="2"
          />

          <rect
            className="printer-power"
            x="125"
            y="110"
            width="15"
            height="6"
            rx="3"
            fill="url(#printerButtonAccent)"
          />
          <circle
            className="printer-status-dot"
            cx="58"
            cy="113"
            r="3"
            fill="#FB8D34"
          />
          <rect x="55" y="135" width="90" height="4" rx="2" fill="#E9DED3" />
          <rect
            className="printer-tray-glow"
            x="55"
            y="135"
            width="90"
            height="4"
            rx="2"
            fill="#FB8D34"
            opacity="0.3"
          />

          <rect x="55" y="135" width="90" height="4" rx="2" fill="#E9DED3" />
          <rect
            className="printer-tray-glow"
            x="55"
            y="135"
            width="90"
            height="4"
            rx="2"
            fill="#FB8D34"
            opacity="0.3"
          />

          <g className="print-sparkles" opacity="0.55">
            <circle
              className="sparkle sparkle-1"
              cx="42"
              cy="72"
              r="1.6"
              fill="#FFC665"
            />
            <circle
              className="sparkle sparkle-2"
              cx="156"
              cy="74"
              r="1.4"
              fill="#FB8D34"
            />
            <circle
              className="sparkle sparkle-3"
              cx="148"
              cy="154"
              r="1.2"
              fill="#FFC665"
            />
            <circle
              className="sparkle sparkle-4"
              cx="35"
              cy="110"
              r="1.3"
              fill="#FB8D34"
              opacity="0.7"
            />
            <circle
              className="sparkle sparkle-5"
              cx="162"
              cy="130"
              r="1.5"
              fill="#FFC665"
              opacity="0.7"
            />
            <circle
              className="sparkle sparkle-6"
              cx="48"
              cy="155"
              r="1.2"
              fill="#FB8D34"
              opacity="0.6"
            />
            <circle
              className="sparkle sparkle-7"
              cx="155"
              cy="95"
              r="1.4"
              fill="#FFC665"
              opacity="0.75"
            />
          </g>
        </svg>
      </div>
      {showDelayMessage ? (
        <p
          className={
            showSlowMessage
              ? "loader-delay-text is-visible"
              : "loader-delay-text"
          }
        >
          Taking longer, kindly wait...
        </p>
      ) : null}
    </div>
  );
}
