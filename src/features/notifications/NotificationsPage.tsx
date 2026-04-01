import { useEffect, useMemo, useRef, useState } from "react";
import { connectNotificationsSocket } from "../../services/realtime/notificationsSocket";
import { getTokenBundle } from "../../services/storage/tokenStorage";
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  NotificationItem,
} from "../../services/api/notificationsApi";
import { useAuth } from "../auth/auth-context";

type InAppAlert = {
  id: string;
  title: string;
  message: string;
};

function coerceText(value: unknown, fallback = ""): string {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function normalizeNotificationPayload(
  payload: unknown,
): NotificationItem | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const id = coerceText(record.id);
  const title = coerceText(record.title, "Notification");
  const message = coerceText(record.message, "You have a new update.");
  const createdAt = coerceText(record.createdAt, new Date().toISOString());
  if (!id) return null;

  return {
    id,
    userId: coerceText(record.userId),
    title,
    message,
    type: coerceText(record.type, "GENERAL"),
    isRead: Boolean(record.isRead),
    printJobId: coerceText(record.printJobId) || null,
    createdAt,
  };
}

export function NotificationsPage() {
  const { refreshUnreadCount } = useAuth();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [error, setError] = useState("");
  const [socketStatus, setSocketStatus] = useState<
    "connecting" | "online" | "offline"
  >("connecting");
  const [alert, setAlert] = useState<InAppAlert | null>(null);
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const alertTimerRef = useRef<number | null>(null);

  const showAlert = (next: InAppAlert) => {
    setAlert(next);
    if (alertTimerRef.current) {
      window.clearTimeout(alertTimerRef.current);
    }
    alertTimerRef.current = window.setTimeout(() => {
      setAlert((prev) => (prev?.id === next.id ? null : prev));
    }, 3200);
  };

  useEffect(() => {
    void getNotifications(1, 50)
      .then((res) => setItems(res.data))
      .catch((e) =>
        setError((e as Error).message || "Failed to load notifications"),
      );

    let isMounted = true;
    let cleanup: (() => void) | null = null;
    void getTokenBundle()
      .then((bundle) => {
        if (!bundle?.accessToken || !isMounted) {
          setSocketStatus("offline");
          return;
        }
        const socket = connectNotificationsSocket(bundle.accessToken, {
          onNotification: (payload) => {
            const next = normalizeNotificationPayload(payload);
            if (!next) return;
            setItems((prev) =>
              prev.some((entry) => entry.id === next.id)
                ? prev
                : [next, ...prev],
            );
            showAlert({
              id: next.id,
              title: next.title,
              message: next.message,
            });
          },
          onUnreadCount: () => {
            void refreshUnreadCount();
          },
          onQueuePositionUpdate: (payload) => {
            const record = payload as Record<string, unknown>;
            const jobNumber = coerceText(record.jobNumber, "Order");
            const position = coerceText(record.position, "-");
            const minutes = coerceText(record.estimatedMinutes, "-");
            const syntheticId = `queue-${coerceText(record.jobId, "unknown")}-${Date.now()}`;
            const next: NotificationItem = {
              id: syntheticId,
              userId: "",
              title: "Queue Update",
              message: `${jobNumber}: position ${position}, approx ${minutes} min`,
              type: "ORDER_STATUS",
              isRead: false,
              printJobId: coerceText(record.jobId) || null,
              createdAt: new Date().toISOString(),
            };
            setItems((prev) => [next, ...prev]);
            showAlert({
              id: syntheticId,
              title: next.title,
              message: next.message,
            });
          },
        });
        socket.on("connect", () => setSocketStatus("online"));
        socket.on("disconnect", () => setSocketStatus("offline"));
        cleanup = () => socket.disconnect();
      })
      .catch(() => setSocketStatus("offline"));

    return () => {
      isMounted = false;
      if (alertTimerRef.current) {
        window.clearTimeout(alertTimerRef.current);
        alertTimerRef.current = null;
      }
      cleanup?.();
    };
  }, [refreshUnreadCount]);

  const sortedItems = useMemo(
    () =>
      [...items].sort(
        (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
      ),
    [items],
  );

  const onMarkOneRead = async (item: NotificationItem) => {
    if (item.isRead) return;
    try {
      await markNotificationRead(item.id);
      setItems((prev) =>
        prev.map((entry) =>
          entry.id === item.id ? { ...entry, isRead: true } : entry,
        ),
      );
      await refreshUnreadCount();
    } catch (e) {
      setError((e as Error).message || "Failed to mark notification as read");
    }
  };

  const onMarkAllRead = async () => {
    try {
      setIsMarkingAll(true);
      await markAllNotificationsRead();
      setItems((prev) => prev.map((item) => ({ ...item, isRead: true })));
      await refreshUnreadCount();
    } catch (e) {
      setError((e as Error).message || "Failed to mark notifications as read");
    } finally {
      setIsMarkingAll(false);
    }
  };

  return (
    <section className="page-animate notifications-page">
      <div className="row">
        <h2>Notifications</h2>
        <div className="row notifications-header-right">
          <span
            className={
              socketStatus === "online"
                ? "status-pill socket-online"
                : "status-pill socket-offline"
            }
          >
            {socketStatus === "online"
              ? "Live"
              : socketStatus === "connecting"
                ? "Connecting"
                : "Offline"}
          </span>
          <button
            className="btn-secondary"
            onClick={onMarkAllRead}
            type="button"
            disabled={isMarkingAll}
          >
            {isMarkingAll ? "Marking..." : "Mark all read"}
          </button>
        </div>
      </div>
      {alert ? (
        <article
          className="card inapp-alert animate-rise delay-1"
          key={alert.id}
        >
          <strong>{alert.title}</strong>
          <p>{alert.message}</p>
        </article>
      ) : null}
      <div className="grid animated-grid">
        {error ? <article className="card error">{error}</article> : null}
        {!error && !sortedItems.length ? (
          <article className="card">No notifications.</article>
        ) : null}
        {sortedItems.map((item) => (
          <article
            className={
              item.isRead
                ? "card notification-card animate-rise"
                : "card notification-card unread animate-rise"
            }
            key={item.id}
          >
            <h3>{item.title}</h3>
            <p>{item.message}</p>
            <p>{new Date(item.createdAt).toLocaleString()}</p>
            <div className="row">
              <p>{item.isRead ? "Read" : "Unread"}</p>
              {!item.isRead ? (
                <button
                  className="btn-secondary btn-small"
                  type="button"
                  onClick={() => void onMarkOneRead(item)}
                >
                  Mark read
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
