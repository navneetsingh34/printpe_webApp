import { useNavigate } from "react-router-dom";

type BackButtonProps = {
  fallbackPath?: string;
  label?: string;
  className?: string;
  onClick?: () => void;
};

export function BackButton({
  fallbackPath = "/",
  label = "Back",
  className = "",
  onClick,
}: BackButtonProps) {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      className={`back-button ${className}`.trim()}
      onClick={() => {
        if (onClick) {
          onClick();
          return;
        }
        if (window.history.length > 1) {
          navigate(-1);
          return;
        }
        navigate(fallbackPath);
      }}
      aria-label={label}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      <span>{label}</span>
    </button>
  );
}
