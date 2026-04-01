import { useEffect, useMemo, useState } from "react";
import { OrderItem } from "../../shared/types/order";
import {
  getMyOrders,
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

type DisplayStatus = (typeof TRACK_STATUSES)[number] | "cancelled";
type QueueInfo = { position: number | null; estimatedMinutes: number | null };
type OrderTab = "latest" | "old";

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
  if (status === "picked_up") return "ready_for_pickup";
  if (TRACK_STATUSES.includes(status as (typeof TRACK_STATUSES)[number])) {
    return status as DisplayStatus;
  }
  return "queued";
}

function getStatusIndex(status: DisplayStatus): number {
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
  return titleCase(status);
}

function formatTimelineLabel(status: (typeof TRACK_STATUSES)[number]): string {
  if (status === "ready_for_pickup") return "Collect";
  return titleCase(status);
}

function isOldOrder(rawStatus: string): boolean {
  const status = String(rawStatus || "")
    .trim()
    .toLowerCase();
  return (
    status.includes("complete") ||
    status.includes("cancel") ||
    status === "picked_up"
  );
}

export function OrdersPage() {
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [queueMap, setQueueMap] = useState<Record<string, QueueInfo>>({});
  const [activeTab, setActiveTab] = useState<OrderTab>("latest");

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

      const onOrderUpdate = (payload: OrderUpdatedPayload) => {
        const targetId = payload.id ?? payload.jobId;
        if (!targetId) return;
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
            return {
              ...prev,
              [targetId]: {
                position:
                  payload.queuePosition !== undefined
                    ? payload.queuePosition
                    : current.position,
                estimatedMinutes:
                  payload.estimatedReadyTime !== undefined
                    ? current.estimatedMinutes
                    : current.estimatedMinutes,
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
    const tenMinutesMs = 10 * 60 * 1000;
    return orders.filter((order) => {
      if (isOldOrder(order.status)) return false;
      const createdAtMs = new Date(order.createdAt).getTime();
      if (Number.isNaN(createdAtMs)) return false;
      return now - createdAtMs <= tenMinutesMs;
    });
  }, [orders]);

  const oldOrders = useMemo(
    () =>
      orders.filter(
        (order) => !latestOrders.some((item) => item.id === order.id),
      ),
    [orders, latestOrders],
  );

  if (loading) {
    return (
      <div className="loader-screen">
        <PrinterLoading />
      </div>
    );
  }
  if (error) return <div className="card error">{error}</div>;
  if (!orders.length) return <div className="card">No orders yet.</div>;

  return (
    <section className="page-animate orders-page">
      <div className="row orders-header-row">
        <h2>My Orders</h2>
        <div className="row notifications-header-right">
          {refreshing ? (
            <div className="inline-loader">
              <PrinterLoading showDelayMessage={false} />
            </div>
          ) : null}
          <span className="status-pill orders-latest-pill">
            {latestOrders.length} latest
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
            {latestOrders.map((order) => (
              <article className="card order-card animate-rise" key={order.id}>
                <div className="row">
                  <h3>{order.jobNumber}</h3>
                  <span
                    className={
                      normalizeTrackingStatus(order.status) === "cancelled"
                        ? "status-pill socket-offline"
                        : "status-pill"
                    }
                  >
                    {formatStatusLabel(normalizeTrackingStatus(order.status))}
                  </span>
                </div>

                <div className="order-meta-grid">
                  <p>Pages: {order.totalPages}</p>
                  <p>Total: {formatCurrency(order.totalPrice)}</p>
                  <p>Created: {formatDateTime(order.createdAt)}</p>
                  <p>Est. ready: {formatDateTime(order.estimatedReadyTime)}</p>
                </div>

                <div className="order-timeline">
                  {TRACK_STATUSES.map((status, index) => {
                    const current = getStatusIndex(
                      normalizeTrackingStatus(order.status),
                    );
                    const reached =
                      index <= current &&
                      normalizeTrackingStatus(order.status) !== "cancelled";
                    return (
                      <div
                        key={`${order.id}-${status}`}
                        className="timeline-step"
                      >
                        <span
                          className={
                            reached ? "timeline-dot reached" : "timeline-dot"
                          }
                        />
                        <span
                          className={
                            index === current
                              ? "timeline-label current"
                              : "timeline-label"
                          }
                        >
                          {formatTimelineLabel(status)}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="row order-live-row">
                  <p>
                    Queue: #
                    {queueMap[order.id]?.position ??
                      order.queuePosition ??
                      "N/A"}
                  </p>
                  <p>
                    ETA: {queueMap[order.id]?.estimatedMinutes ?? "N/A"} min
                  </p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="card orders-empty-card">
            No latest orders from last 10 minutes.
          </div>
        )
      ) : oldOrders.length ? (
        <div className="grid orders-grid animated-grid">
          {oldOrders.map((order) => (
            <article
              className="card old-order-card animate-rise"
              key={order.id}
            >
              <div className="row">
                <h3>{order.jobNumber}</h3>
                <span
                  className={
                    normalizeTrackingStatus(order.status) === "cancelled"
                      ? "status-pill socket-offline"
                      : "status-pill"
                  }
                >
                  {formatStatusLabel(normalizeTrackingStatus(order.status))}
                </span>
              </div>
              <p>Created: {formatDateTime(order.createdAt)}</p>
              <p>Total: {formatCurrency(order.totalPrice)}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="card orders-empty-card">No old orders yet.</div>
      )}
    </section>
  );
}
