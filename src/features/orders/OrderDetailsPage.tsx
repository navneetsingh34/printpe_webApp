import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { jsPDF } from "jspdf";
import {
  getMyOrders,
  getOrderQueuePosition,
} from "../../services/api/ordersApi";
import { OrderItem } from "../../shared/types/order";
import { BackButton } from "../../shared/ui/BackButton";
import { PrinterLoading } from "../../shared/ui/PrinterLoading";

type QueueInfo = { position: number | null; estimatedMinutes: number | null };

type LocationState = {
  order?: OrderItem;
  queueInfo?: QueueInfo;
};

function formatCurrency(value: number): string {
  return `Rs ${Number(value || 0).toFixed(2)}`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleString();
}

function normalizeStatus(rawStatus: string): string {
  const status = String(rawStatus || "")
    .trim()
    .toLowerCase();
  if (!status) return "queued";
  if (status === "ready_for_pickup") return "collect now";
  return status.replaceAll("_", " ");
}

function formatTimeRemaining(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "Calculating...";
  const numMinutes =
    typeof minutes === "string" ? parseInt(minutes, 10) : minutes;
  if (Number.isNaN(numMinutes)) return "Calculating...";
  if (numMinutes < 0) return "Ready soon";
  if (numMinutes === 0) return "Ready now";
  if (numMinutes < 60) return `${numMinutes}m left`;
  const hours = Math.floor(numMinutes / 60);
  const mins = numMinutes % 60;
  return `${hours}h ${mins}m left`;
}

function downloadOrderPdf(order: OrderItem, queueInfo: QueueInfo) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  let y = 52;

  const row = (label: string, value: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(label, 46, y);
    doc.setFont("helvetica", "normal");
    doc.text(value, 170, y);
    y += 22;
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Order Details", 46, y);
  y += 28;

  doc.setDrawColor(235, 235, 235);
  doc.line(46, y, 548, y);
  y += 24;

  row("Order Number", order.jobNumber || "-");
  row("Order ID", order.id || "-");
  row("Status", normalizeStatus(order.status));
  row("File", "Document.pdf");
  row("Pages", String(order.totalPages ?? 0));
  row("Amount", formatCurrency(order.totalPrice));
  row("Placed At", formatDateTime(order.createdAt));
  row(
    "Queue Position",
    queueInfo.position !== null && queueInfo.position !== undefined
      ? `#${queueInfo.position}`
      : "N/A",
  );
  row("Estimated Time", formatTimeRemaining(queueInfo.estimatedMinutes));

  y += 20;
  doc.setFontSize(10);
  doc.setTextColor(110, 110, 110);
  doc.text(`Generated on ${new Date().toLocaleString()}`, 46, y);

  const safeJob = (order.jobNumber || order.id || "order").replace(
    /[^a-zA-Z0-9-_]/g,
    "_",
  );
  doc.save(`order-${safeJob}.pdf`);
}

export function OrderDetailsPage() {
  const { orderId = "" } = useParams();
  const location = useLocation();
  const state = (location.state as LocationState | null) ?? null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<OrderItem | null>(state?.order ?? null);
  const [queueInfo, setQueueInfo] = useState<QueueInfo>(
    state?.queueInfo ?? { position: null, estimatedMinutes: null },
  );

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setLoading(true);
      setError("");
      try {
        let nextOrder = state?.order ?? null;

        if (!nextOrder || nextOrder.id !== orderId) {
          const allOrders = await getMyOrders();
          nextOrder = allOrders.find((item) => item.id === orderId) ?? null;
        }

        if (!nextOrder) {
          throw new Error("Order not found.");
        }

        const queue = await getOrderQueuePosition(nextOrder.id).catch(
          () => null,
        );

        if (!mounted) return;

        setOrder(nextOrder);
        setQueueInfo({
          position:
            queue?.position ??
            state?.queueInfo?.position ??
            nextOrder.queuePosition ??
            null,
          estimatedMinutes:
            queue?.estimatedMinutes ??
            state?.queueInfo?.estimatedMinutes ??
            nextOrder.queuePosition ??
            null,
        });
      } catch (loadError) {
        if (mounted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load order",
          );
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();

    return () => {
      mounted = false;
    };
  }, [orderId, state?.order, state?.queueInfo]);

  const statusText = useMemo(
    () => (order ? normalizeStatus(order.status) : "-"),
    [order],
  );

  if (loading) {
    return (
      <div className="loader-screen">
        <PrinterLoading />
      </div>
    );
  }

  if (error || !order) {
    return (
      <section className="page-animate orders-page">
        <div className="card error">{error || "Order not found."}</div>
        <BackButton fallbackPath="/orders" label="Back to Orders" />
      </section>
    );
  }

  return (
    <section className="page-animate orders-page order-details-page">
      <div className="order-details-backbar">
        <BackButton fallbackPath="/orders" label="Back" />
      </div>
      <div className="row orders-header-row">
        <h2>Order Details</h2>
      </div>

      <article className="card order-detail-modal-card">
        <div className="order-detail-grid">
          <p>
            <strong>Order Number:</strong> {order.jobNumber}
          </p>
          <p>
            <strong>Order ID:</strong> {order.id}
          </p>
          <p>
            <strong>Status:</strong> {statusText}
          </p>
          <p>
            <strong>File:</strong> Document.pdf
          </p>
          <p>
            <strong>Pages:</strong> {order.totalPages}
          </p>
          <p>
            <strong>Amount:</strong> {formatCurrency(order.totalPrice)}
          </p>
          <p>
            <strong>Placed At:</strong> {formatDateTime(order.createdAt)}
          </p>
          <p>
            <strong>Queue Position:</strong> {queueInfo.position ?? "N/A"}
          </p>
          <p>
            <strong>Estimated Time:</strong>{" "}
            {formatTimeRemaining(queueInfo.estimatedMinutes)}
          </p>
        </div>

        <div className="order-detail-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={() => downloadOrderPdf(order, queueInfo)}
          >
            Download PDF
          </button>
        </div>
      </article>
    </section>
  );
}
