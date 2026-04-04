import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { OrderItem } from "../../shared/types/order";
import {
  collectOrder,
  getMyOrders,
  getOrderDocumentUrls,
  OrderDocumentItem,
  getOrderQueuePosition,
} from "../../services/api/ordersApi";
import {
  connectOrderTrackingSocket,
  OrderUpdatedPayload,
} from "../../services/realtime/orderTrackingSocket";
import { getTokenBundle } from "../../services/storage/tokenStorage";
import { PrinterLoading } from "../../shared/ui/PrinterLoading";

const TRACK_STATUSES = [
  "paid",
  "queued",
  "printed",
  "ready_for_pickup",
] as const;

type DisplayStatus = (typeof TRACK_STATUSES)[number] | "picked_up" | "cancelled";
type QueueInfo = { position: number | null; estimatedMinutes: number | null };
type OrderTab = "latest" | "old";

const LATEST_ORDERS_WINDOW_MS = 8 * 60 * 60 * 1000;

// Status icons and colors for real-time visual feedback
const STATUS_CONFIG: Record<
  DisplayStatus,
  { icon: string; color: string; bgColor: string }
> = {
  paid: { icon: "💳", color: "#8b5cf6", bgColor: "#f3e8ff" },
  queued: { icon: "⏳", color: "#f59e0b", bgColor: "#fef3c7" },
  printed: { icon: "🖨️", color: "#10b981", bgColor: "#d1fae5" },
  ready_for_pickup: { icon: "✨", color: "#8a5220", bgColor: "#ffe9d3" },
  picked_up: { icon: "✅", color: "#166534", bgColor: "#dcfce7" },
  cancelled: { icon: "❌", color: "#ef4444", bgColor: "#fee2e2" },
};

function normalizeTrackingStatus(rawStatus: string): DisplayStatus {
  const status = String(rawStatus || "")
    .trim()
    .toLowerCase();
  if (!status) return "queued";
  if (status === "cancelled") return "cancelled";
  if (
    status === "pending_payment" ||
    status === "payment_failed" ||
    status === "failed_payment" ||
    status === "payment_cancelled"
  ) {
    return "cancelled";
  }
  if (status === "processing") return "queued";
  if (status === "picked_up") return "picked_up";
  if (TRACK_STATUSES.includes(status as (typeof TRACK_STATUSES)[number])) {
    return status as DisplayStatus;
  }
  return "queued";
}

function getStatusIndex(status: DisplayStatus): number {
  if (status === "picked_up") return TRACK_STATUSES.length - 1;
  const idx = TRACK_STATUSES.indexOf(status as (typeof TRACK_STATUSES)[number]);
  return idx < 0 ? 0 : idx;
}

function formatCurrency(value: number): string {
  return `Rs ${Number(value || 0).toFixed(2)}`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleString();
}

function titleCase(input: string): string {
  return input
    .replaceAll("_", " ")
    .split(" ")
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(" ");
}

function formatStatusLabel(status: DisplayStatus): string {
  if (status === "ready_for_pickup") return "Collect now";
  if (status === "picked_up") return "Picked up";
  return titleCase(status);
}

function formatTimelineLabel(status: (typeof TRACK_STATUSES)[number]): string {
  if (status === "ready_for_pickup") return "Collect";
  return titleCase(status);
}

function getProgressPercentage(status: DisplayStatus): number {
  if (status === "picked_up") return 100;
  const statusIdx = TRACK_STATUSES.indexOf(
    status as (typeof TRACK_STATUSES)[number],
  );
  if (status === "cancelled") return 0;
  if (statusIdx < 0) return 0;
  return Math.round(((statusIdx + 1) / TRACK_STATUSES.length) * 100);
}

function formatTimeRemaining(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "Calculating...";
  const numMinutes =
    typeof minutes === "string" ? parseInt(minutes, 10) : minutes;
  if (Number.isNaN(numMinutes)) return "Calculating...";
  if (numMinutes < 0) return "⚡ Ready soon!";
  if (numMinutes === 0) return "⚡ Ready now!";
  if (numMinutes < 60) return `${numMinutes}m left`;
  const hours = Math.floor(numMinutes / 60);
  const mins = numMinutes % 60;
  return `${hours}h ${mins}m left`;
}

export function OrdersPage() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [queueMap, setQueueMap] = useState<Record<string, QueueInfo>>({});
  const [collectingByOrderId, setCollectingByOrderId] = useState<
    Record<string, boolean>
  >({});
  const [docsByOrderId, setDocsByOrderId] = useState<
    Record<string, OrderDocumentItem[]>
  >({});
  const [docsLoadingByOrderId, setDocsLoadingByOrderId] = useState<
    Record<string, boolean>
  >({});
  const [showDocsByOrderId, setShowDocsByOrderId] = useState<
    Record<string, boolean>
  >({});
  const [activeTab, setActiveTab] = useState<OrderTab>("latest");
  const [socketConnected, setSocketConnected] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState<Record<string, number>>(
    {},
  );

  useEffect(() => {
    let mounted = true;
    let disconnectSocket: (() => void) | null = null;

    const enrichQueues = async (nextOrders: OrderItem[]) => {
      const results = await Promise.all(
        nextOrders.map(async (order) => {
          try {
            const queue = await getOrderQueuePosition(order.id);
            return { orderId: order.id, queue };
          } catch {
            return { orderId: order.id, queue: null };
          }
        }),
      );

      if (!mounted) return;
      setQueueMap((prev) => {
        const next = { ...prev };
        results.forEach((entry) => {
          if (!entry.queue) return;
          next[entry.orderId] = {
            position: entry.queue.position,
            estimatedMinutes: entry.queue.estimatedMinutes,
          };
        });
        return next;
      });
    };

    const load = async (isInitial = false) => {
      if (isInitial) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError("");
      try {
        const nextOrders = await getMyOrders();
        if (!mounted) return;
        setOrders(nextOrders);
        void enrichQueues(nextOrders);
      } catch (e) {
        if (mounted) setError((e as Error).message || "Failed to load orders");
      } finally {
        if (mounted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    const bindSocket = async () => {
      const tokens = await getTokenBundle();
      if (!tokens?.accessToken || !mounted) return;
      const socket = connectOrderTrackingSocket(tokens.accessToken);

      socket.on("connect", () => {
        if (mounted) setSocketConnected(true);
      });

      socket.on("disconnect", () => {
        if (mounted) setSocketConnected(false);
      });

      const onOrderUpdate = (payload: OrderUpdatedPayload) => {
        const targetId = payload.id ?? payload.jobId;
        if (!targetId) return;

        // Record update time for real-time indicators
        setLastUpdateTime((prev) => ({ ...prev, [targetId]: Date.now() }));

        setOrders((prev) =>
          prev.map((order) =>
            order.id === targetId
              ? {
                  ...order,
                  status: payload.status ?? order.status,
                  queuePosition:
                    payload.queuePosition !== undefined
                      ? payload.queuePosition
                      : order.queuePosition,
                  estimatedReadyTime:
                    payload.estimatedReadyTime !== undefined
                      ? payload.estimatedReadyTime
                      : order.estimatedReadyTime,
                }
              : order,
          ),
        );

        if (
          payload.queuePosition !== undefined ||
          payload.estimatedReadyTime !== undefined
        ) {
          setQueueMap((prev) => {
            const current = prev[targetId] ?? {
              position: null,
              estimatedMinutes: null,
            };
            const nextEstimatedMinutes =
              payload.estimatedReadyTime !== undefined
                ? typeof payload.estimatedReadyTime === "string"
                  ? parseInt(payload.estimatedReadyTime, 10) || null
                  : payload.estimatedReadyTime
                : current.estimatedMinutes;
            return {
              ...prev,
              [targetId]: {
                position:
                  payload.queuePosition !== undefined
                    ? payload.queuePosition
                    : current.position,
                estimatedMinutes: nextEstimatedMinutes,
              },
            };
          });
        }

        void load(false);
      };

      socket.on("job:updated", onOrderUpdate);
      socket.on("queue:position-update", onOrderUpdate);
      disconnectSocket = () => socket.disconnect();
    };

    void load(true);
    void bindSocket();

    const intervalId = window.setInterval(() => {
      void load(false);
    }, 30000);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
      disconnectSocket?.();
    };
  }, []);

  const latestOrders = useMemo(() => {
    const now = Date.now();
    return orders.filter((order) => {
      const createdAtMs = new Date(order.createdAt).getTime();
      if (Number.isNaN(createdAtMs)) return false;
      return now - createdAtMs <= LATEST_ORDERS_WINDOW_MS;
    });
  }, [orders]);

  const oldOrders = useMemo(
    () =>
      orders.filter(
        (order) => !latestOrders.some((item) => item.id === order.id),
      ),
    [orders, latestOrders],
  );

  const onCollectOrder = async (orderId: string) => {
    setCollectingByOrderId((prev) => ({ ...prev, [orderId]: true }));
    setError("");
    try {
      const updated = await collectOrder(orderId);
      setOrders((prev) =>
        prev.map((order) => (order.id === updated.id ? { ...order, ...updated } : order)),
      );
    } catch (e) {
      setError((e as Error).message || "Unable to mark order as picked up.");
    } finally {
      setCollectingByOrderId((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  const onViewDocs = async (orderId: string) => {
    const alreadyVisible = Boolean(showDocsByOrderId[orderId]);
    if (alreadyVisible) {
      setShowDocsByOrderId((prev) => ({ ...prev, [orderId]: false }));
      return;
    }

    setShowDocsByOrderId((prev) => ({ ...prev, [orderId]: true }));
    if (docsByOrderId[orderId]?.length) {
      return;
    }

    setDocsLoadingByOrderId((prev) => ({ ...prev, [orderId]: true }));
    try {
      const payload = await getOrderDocumentUrls(orderId);
      setDocsByOrderId((prev) => ({
        ...prev,
        [orderId]: payload.documents ?? [],
      }));
    } catch (e) {
      setError((e as Error).message || "Unable to fetch documents.");
      setShowDocsByOrderId((prev) => ({ ...prev, [orderId]: false }));
    } finally {
      setDocsLoadingByOrderId((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  if (loading) {
    return (
      <div className="loader-screen">
        <PrinterLoading />
      </div>
    );
  }
  if (error) return <div className="card error">{error}</div>;
  if (!orders.length) {
    return (
      <div className="card orders-empty-card orders-empty-cta-card">
        <p>No orders yet.</p>
        <button
          type="button"
          className="btn-secondary orders-empty-cta-btn"
          onClick={() => navigate("/")}
        >
          Place an Order
        </button>
      </div>
    );
  }

  return (
    <section className="page-animate orders-page">
      <div className="row orders-header-row">
        <div className="orders-header-content">
          <h2>My Orders</h2>
          <div
            className="socket-status-indicator"
            title={socketConnected ? "Live updates active" : "Connecting..."}
          >
            <span
              className={`status-dot ${socketConnected ? "connected" : "connecting"}`}
            />
            <span className="status-text">
              {socketConnected ? "Live" : "Connecting..."}
            </span>
          </div>
        </div>
        <div className="row notifications-header-right">
          {refreshing ? (
            <div className="inline-loader">
              <PrinterLoading showDelayMessage={false} />
            </div>
          ) : null}
          <span className="status-pill orders-latest-pill">
            {latestOrders.length} active
          </span>
        </div>
      </div>

      <div className="orders-tabs">
        <button
          type="button"
          className={
            activeTab === "latest"
              ? "btn-secondary orders-tab-btn active-segment"
              : "btn-secondary orders-tab-btn"
          }
          onClick={() => setActiveTab("latest")}
        >
          Latest Orders
        </button>
        <button
          type="button"
          className={
            activeTab === "old"
              ? "btn-secondary orders-tab-btn active-segment"
              : "btn-secondary orders-tab-btn"
          }
          onClick={() => setActiveTab("old")}
        >
          Old Orders
        </button>
      </div>

      {activeTab === "latest" ? (
        latestOrders.length ? (
          <div className="grid orders-grid animated-grid">
            {latestOrders.map((order) => {
              const displayStatus = normalizeTrackingStatus(order.status);
              const statusConfig = STATUS_CONFIG[displayStatus];

              const estimatedMinutes =
                queueMap[order.id]?.estimatedMinutes ?? order.queuePosition;
              const isRecentUpdate =
                lastUpdateTime[order.id] &&
                Date.now() - lastUpdateTime[order.id] < 5000;

              return (
                <article
                  className={`card order-card premium-style animate-rise ${isRecentUpdate ? "real-time-pulse" : ""}`}
                  key={order.id}
                >
                  {/* Real-time update indicator */}
                  {isRecentUpdate && <div className="update-pulse-ring" />}

                  {/* Premium Header */}
                  <div className="premium-header">
                    <div className="header-left">
                      <h3 className="order-id-premium">{order.jobNumber}</h3>
                      <p className="order-subtitle">Order Details</p>
                    </div>
                    <span
                      className={`status-badge-premium status-${displayStatus}`}
                      style={{
                        backgroundColor: statusConfig.bgColor,
                        color: statusConfig.color,
                      }}
                    >
                      <span className="status-icon">{statusConfig.icon}</span>
                      <span>{formatStatusLabel(displayStatus)}</span>
                    </span>
                  </div>

                  {/* Order Details Section - Like Reference */}
                  <div className="order-details-premium">
                    <div className="detail-item">
                      <span className="detail-label">File</span>
                      <span className="detail-value">Document.pdf</span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Pages</span>
                      <span className="detail-value">{order.totalPages}</span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Amount</span>
                      <span className="detail-value">
                        {formatCurrency(order.totalPrice)}
                      </span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Placed</span>
                      <span className="detail-value">
                        {formatDateTime(order.createdAt)}
                      </span>
                    </div>
                  </div>

                  {/* Straight timeline with statuses above */}
                  <div className="zigzag-timeline-wrapper">
                    <div className="timeline-labels-top">
                      {TRACK_STATUSES.map((status, index) => {
                        const current = getStatusIndex(displayStatus);
                        const reached =
                          index <= current && displayStatus !== "cancelled";
                        return (
                          <div
                            key={`label-${order.id}-${status}`}
                            className={`timeline-label-top ${reached ? "reached" : ""} ${index === current ? "current" : ""}`}
                          >
                            <span className="label-text">
                              {formatTimelineLabel(status)}
                            </span>
                            <span className="status-dot-top" />
                          </div>
                        );
                      })}
                    </div>

                    <div className="straight-timeline" aria-hidden="true">
                      <div className="straight-line-base" />
                      <div
                        className={`straight-line-progress ${displayStatus === "cancelled" ? "cancelled" : ""}`}
                        style={{
                          width: `${getProgressPercentage(displayStatus)}%`,
                        }}
                      />
                      {TRACK_STATUSES.map((status, index) => {
                        const current = getStatusIndex(displayStatus);
                        const reached =
                          index <= current && displayStatus !== "cancelled";
                        return (
                          <span
                            key={`point-${order.id}-${status}`}
                            className={`straight-point ${reached ? "reached" : ""} ${index === current ? "current" : ""}`}
                            style={{
                              left: `${(index / (TRACK_STATUSES.length - 1)) * 100}%`,
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>

                  {/* Live Status & Actions */}
                  <div className="live-status-section">
                    <div className="eta-info">
                      {socketConnected && (
                        <div className="realtime-badge-premium">
                          <span className="live-dot" />
                          Real-time
                        </div>
                      )}
                      <button
                        className="btn-refresh-eta"
                        type="button"
                        title="Refresh estimated time"
                      >
                        🔄 Refresh ETA
                      </button>
                    </div>
                    <p className="queue-eta">
                      Queue #
                      {queueMap[order.id]?.position ??
                        order.queuePosition ??
                        "N/A"}{" "}
                      • ETA:{" "}
                      {formatTimeRemaining(
                        queueMap[order.id]?.estimatedMinutes ??
                          estimatedMinutes,
                      )}
                    </p>
                  </div>

                  {/* Action Buttons */}
                  <div className="order-actions">
                    {displayStatus === "ready_for_pickup" ? (
                      <button
                        className="action-btn"
                        type="button"
                        onClick={() => void onCollectOrder(order.id)}
                        disabled={Boolean(collectingByOrderId[order.id])}
                      >
                        {collectingByOrderId[order.id]
                          ? "⏳ Updating..."
                          : "✅ Collect Now"}
                      </button>
                    ) : null}
                    <button
                      className="action-btn secondary"
                      type="button"
                      onClick={() => void onViewDocs(order.id)}
                    >
                      📄 View Docs
                    </button>
                  </div>

                  {showDocsByOrderId[order.id] ? (
                    <div className="card" style={{ marginTop: 10 }}>
                      <p style={{ margin: 0, fontWeight: 700 }}>Uploaded Documents</p>
                      {docsLoadingByOrderId[order.id] ? (
                        <p style={{ marginTop: 8 }}>Loading documents...</p>
                      ) : (docsByOrderId[order.id] ?? []).length === 0 ? (
                        <p style={{ marginTop: 8 }}>No documents found for this order.</p>
                      ) : (
                        <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                          {(docsByOrderId[order.id] ?? []).map((doc, index) => (
                            <button
                              key={`${order.id}-${doc.fileId}-${index}`}
                              className="action-btn secondary"
                              type="button"
                              onClick={() => window.open(doc.url, "_blank", "noopener,noreferrer")}
                            >
                              {`${index + 1}. ${doc.name} (${doc.pageCount} pages, ${doc.copies} copies)`}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="card orders-empty-card orders-empty-cta-card">
            <p>No latest orders in the last 8 hours.</p>
            <button
              type="button"
              className="btn-secondary orders-empty-cta-btn"
              onClick={() => navigate("/")}
            >
              Place an Order
            </button>
          </div>
        )
      ) : oldOrders.length ? (
        <div className="grid orders-grid animated-grid">
          {oldOrders.map((order) => {
            const displayStatus = normalizeTrackingStatus(order.status);
            const statusConfig = STATUS_CONFIG[displayStatus];
            const estimatedMinutes =
              queueMap[order.id]?.estimatedMinutes ?? order.queuePosition;

            return (
              <article
                className="card old-order-card premium-style animate-rise"
                key={order.id}
              >
                <div className="old-order-header">
                  <h3>{order.jobNumber}</h3>
                  <span
                    className={`status-badge status-${displayStatus}`}
                    style={{
                      backgroundColor: statusConfig.bgColor,
                      color: statusConfig.color,
                    }}
                  >
                    <span className="status-icon">{statusConfig.icon}</span>
                    <span>{formatStatusLabel(displayStatus)}</span>
                  </span>
                </div>
                <p className="old-order-meta">
                  <span className="meta-label">Created:</span>{" "}
                  {formatDateTime(order.createdAt)}
                </p>
                <p className="old-order-meta">
                  <span className="meta-label">Total:</span>{" "}
                  {formatCurrency(order.totalPrice)}
                </p>
                <div className="order-actions">
                  <button
                    className="action-btn secondary"
                    type="button"
                    onClick={() =>
                      navigate(`/orders/${encodeURIComponent(order.id)}`, {
                        state: {
                          order,
                          queueInfo: queueMap[order.id] ?? {
                            position: order.queuePosition ?? null,
                            estimatedMinutes,
                          },
                        },
                      })
                    }
                  >
                    📋 View Details
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="card orders-empty-card orders-empty-cta-card">
          <p>No old orders yet.</p>
          <button
            type="button"
            className="btn-secondary orders-empty-cta-btn"
            onClick={() => navigate("/")}
          >
            Place an Order
          </button>
        </div>
      )}
    </section>
  );
}
