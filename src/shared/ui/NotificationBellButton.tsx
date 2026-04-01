import { useEffect } from "react";
import { useAuth } from "../../features/auth/auth-context";

type Props = {
  onClick: () => void;
};

export function NotificationBellButton({ onClick }: Props) {
  const { unreadCount, refreshUnreadCount } = useAuth();

  useEffect(() => {
    void refreshUnreadCount().catch(() => undefined);
  }, [refreshUnreadCount]);

  return (
    <button type="button" className="bell-btn" onClick={onClick}>
      <span className="bell-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M12 4.7C9.2 4.7 7.1 7 7.1 9.8V12.1C7.1 13.1 6.8 14.1 6.2 14.9L5.4 16H18.6L17.8 14.9C17.2 14.1 16.9 13.1 16.9 12.1V9.8C16.9 7 14.8 4.7 12 4.7Z"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M10.1 18C10.4 18.9 11.1 19.4 12 19.4C12.9 19.4 13.6 18.9 13.9 18"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M9.1 5.9C9.7 5.4 10.8 5 12 5C13.2 5 14.3 5.4 14.9 5.9"
            stroke="currentColor"
            strokeWidth="1.35"
            strokeLinecap="round"
            opacity="0.55"
          />
        </svg>
      </span>
      {unreadCount > 0 ? <span className="badge">{unreadCount}</span> : null}
    </button>
  );
}
