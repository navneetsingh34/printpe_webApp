import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { jsPDF } from "jspdf";
import {
  getMyOrders,
  getOrderQueuePosition,
  reportShop,
} from "../../services/api/ordersApi";
import { OrderItem } from "../../shared/types/order";
import { BackButton } from "../../shared/ui/BackButton";
import { PrinterLoading } from "../../shared/ui/PrinterLoading";

type QueueInfo = { position: number | null; estimatedMinutes: number | null };

type LocationState = {
  order?: OrderItem;
  queueInfo?: QueueInfo;
};

type ReportFormState = {
  issueCode: string;
  customIssue: string;
  details: string;
};

const ISSUE_CODES = [
  { code: "quality_issue", label: "Quality Issue (blurry, wrong colors, etc.)" },
  { code: "order_not_fulfilled", label: "Order Not Fulfilled" },
  { code: "wrong_order", label: "Wrong Order Delivered" },
  { code: "payment_issue", label: "Payment Issue" },
  { code: "unprofessional_behavior", label: "Unprofessional Behavior" },
  { code: "safety_concern", label: "Safety or Health Concern" },
  { code: "other", label: "Other Issue" },
];

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
  if (!status) return "order";
  if (status === "pending_payment") return "order";
  if (status === "queued" || status === "processing") return "printing";
  if (status === "printed" || status === "ready_for_pickup") return "printed";
  if (status === "picked_up") return "collected";
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
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportFormState, setReportFormState] = useState<ReportFormState>({
    issueCode: "",
    customIssue: "",
    details: "",
  });
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reportSuccess, setReportSuccess] = useState(false);

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

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!order || reportSubmitting) return;

    if (!reportFormState.issueCode.trim()) {
      setReportError("Please select an issue type");
      return;
    }

    setReportSubmitting(true);
    setReportError("");
    setReportSuccess(false);

    try {
      await reportShop({
        shopId: order.shopId,
        issueCode: reportFormState.issueCode,
        customIssue: reportFormState.customIssue || undefined,
        details: reportFormState.details || undefined,
        printJobId: order.id,
      });

      setReportSuccess(true);
      setReportFormState({ issueCode: "", customIssue: "", details: "" });
      
      setTimeout(() => {
        setShowReportModal(false);
        setReportSuccess(false);
      }, 2000);
    } catch (submitError) {
      setReportError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to submit report. Please try again.",
      );
    } finally {
      setReportSubmitting(false);
    }
  };

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
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowReportModal(true)}
          >
            Report Issue
          </button>
        </div>
      </article>

      {showReportModal && (
        <div
          className="modal-overlay"
          onClick={() => setShowReportModal(false)}
        >
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "500px" }}
          >
            <div className="modal-header">
              <h3>Report an Issue</h3>
              <button
                type="button"
                className="modal-close"
                onClick={() => setShowReportModal(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleReportSubmit}>
              <div className="form-group">
                <label htmlFor="issueCode">Issue Type *</label>
                <select
                  id="issueCode"
                  value={reportFormState.issueCode}
                  onChange={(e) =>
                    setReportFormState({
                      ...reportFormState,
                      issueCode: e.target.value,
                    })
                  }
                  disabled={reportSubmitting}
                >
                  <option value="">Select an issue type...</option>
                  {ISSUE_CODES.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="customIssue">Issue Summary</label>
                <input
                  id="customIssue"
                  type="text"
                  placeholder="Brief summary of the issue"
                  value={reportFormState.customIssue}
                  onChange={(e) =>
                    setReportFormState({
                      ...reportFormState,
                      customIssue: e.target.value,
                    })
                  }
                  disabled={reportSubmitting}
                  maxLength={300}
                />
                <small style={{ color: "#999" }}>
                  {reportFormState.customIssue.length}/300
                </small>
              </div>

              <div className="form-group">
                <label htmlFor="details">Additional Details</label>
                <textarea
                  id="details"
                  placeholder="Provide more details about what happened..."
                  value={reportFormState.details}
                  onChange={(e) =>
                    setReportFormState({
                      ...reportFormState,
                      details: e.target.value,
                    })
                  }
                  disabled={reportSubmitting}
                  maxLength={1000}
                  rows={4}
                />
                <small style={{ color: "#999" }}>
                  {reportFormState.details.length}/1000
                </small>
              </div>

              {reportError && (
                <div className="form-error">{reportError}</div>
              )}

              {reportSuccess && (
                <div className="form-success">
                  ✓ Report submitted successfully. Thank you!
                </div>
              )}

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowReportModal(false)}
                  disabled={reportSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={reportSubmitting || !reportFormState.issueCode}
                >
                  {reportSubmitting ? "Submitting..." : "Submit Report"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
