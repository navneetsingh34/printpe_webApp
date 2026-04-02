import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/auth-context";
import { useSearchParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import {
  createPaymentOrder,
  createPrintJob,
  getPaymentByOrderId,
  reconcilePayment,
  uploadDocument,
  verifyPayment,
} from "../../services/api/printFlowApi";
import { env } from "../../services/api/env";
import { getAllShops, getShopPricing } from "../../services/api/shopsApi";
import {
  PrintShop,
  ShopPricingConfig,
  TieredRate,
} from "../../shared/types/shop";
import { PrinterLoading } from "../../shared/ui/PrinterLoading";

type PrintStep = "intro" | "upload" | "configure" | "payment";
type PaymentPhase =
  | "idle"
  | "creating_job"
  | "creating_order"
  | "opening_checkout"
  | "verifying_payment"
  | "reconciling"
  | "failed";

const RAZORPAY_CHECKOUT_URL = "https://checkout.razorpay.com/v1/checkout.js";

function ensureRazorpayLoaded(): Promise<void> {
  if (window.Razorpay) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const existing = document.querySelector(
      `script[src="${RAZORPAY_CHECKOUT_URL}"]`,
    ) as HTMLScriptElement | null;

    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Failed to load Razorpay checkout script.")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = RAZORPAY_CHECKOUT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Failed to load Razorpay checkout script."));
    document.body.appendChild(script);
  });
}

function openRazorpayCheckout(options: {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  orderId: string;
  prefill: { name?: string; email?: string; contact?: string };
  notes: Record<string, string>;
}): Promise<{
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}> {
  return new Promise((resolve, reject) => {
    if (!window.Razorpay) {
      reject(new Error("Razorpay SDK not available in browser."));
      return;
    }

    const checkout = new window.Razorpay({
      key: options.key,
      amount: String(options.amount),
      currency: options.currency || "INR",
      name: options.name,
      description: options.description,
      order_id: options.orderId,
      prefill: options.prefill,
      notes: options.notes,
      theme: { color: "#7C4DFF" },
      handler: (response) => resolve(response),
      modal: {
        ondismiss: () => reject(new Error("Razorpay checkout dismissed")),
      },
    });

    checkout.open();
  });
}

function defaultPricing(): ShopPricingConfig {
  return {
    paperPricing: [
      {
        paperSize: "A4",
        enabled: true,
        bw: { firstNPages: 20, firstNRate: 0.5, afterNRate: 0.5 },
        color: { firstNPages: 20, firstNRate: 1.0, afterNRate: 1.0 },
        doubleSidedDiscountPercent: 0,
      },
      {
        paperSize: "A3",
        enabled: true,
        bw: { firstNPages: 20, firstNRate: 1.0, afterNRate: 1.0 },
        color: { firstNPages: 20, firstNRate: 2.0, afterNRate: 2.0 },
        doubleSidedDiscountPercent: 0,
      },
    ],
    bindings: [
      { id: "none", label: "None", price: 0, enabled: true },
      { id: "staple", label: "Staple", price: 5, enabled: true },
      { id: "spiral", label: "Spiral", price: 15, enabled: true },
    ],
  };
}

function normalizePricing(
  value: ShopPricingConfig | null | undefined,
): ShopPricingConfig {
  const defaults = defaultPricing();
  if (!value) return defaults;

  const paperPricing =
    Array.isArray(value.paperPricing) && value.paperPricing.length > 0
      ? value.paperPricing.map((item) => ({
          paperSize: item.paperSize || "A4",
          enabled: item.enabled !== false,
          bw: item.bw ?? defaults.paperPricing[0].bw,
          color: item.color ?? defaults.paperPricing[0].color,
          doubleSidedDiscountPercent:
            Number(item.doubleSidedDiscountPercent ?? 0) || 0,
        }))
      : defaults.paperPricing;

  const bindings =
    Array.isArray(value.bindings) && value.bindings.length > 0
      ? value.bindings.map((item) => ({
          id: item.id || "binding",
          label: item.label || "Binding",
          price: Number(item.price ?? 0) || 0,
          enabled: item.enabled !== false,
        }))
      : defaults.bindings;

  if (!bindings.some((item) => item.id === "none")) {
    bindings.unshift({ id: "none", label: "None", price: 0, enabled: true });
  }

  return { paperPricing, bindings };
}

function validateFile(file: File): string | null {
  const allowed = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];
  const maxBytes = 50 * 1024 * 1024;
  if (!allowed.includes(file.type)) {
    return "Only PDF, DOC, and DOCX files are supported.";
  }
  if (file.size > maxBytes) {
    return "File size must be 50MB or less.";
  }
  return null;
}

function applyDoubleSidedDiscount(
  cost: number,
  discountPercent: number,
  doubleSided: boolean,
): number {
  if (!doubleSided || discountPercent <= 0) return cost;
  return cost - cost * (discountPercent / 100);
}

export function PrintPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [shops, setShops] = useState<PrintShop[]>([]);
  const [shopId, setShopId] = useState("");
  const [step, setStep] = useState<PrintStep>("intro");
  const [pricing, setPricing] = useState<ShopPricingConfig>(defaultPricing());
  const [pricingLoadError, setPricingLoadError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadedFileId, setUploadedFileId] = useState("");
  const [filePages, setFilePages] = useState(1);
  const [copies, setCopies] = useState(1);
  const [color, setColor] = useState(false);
  const [doubleSided, setDoubleSided] = useState(false);
  const [paperSize, setPaperSize] = useState("A4");
  const [binding, setBinding] = useState("none");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdJobId, setCreatedJobId] = useState("");
  const [createdJobNumber, setCreatedJobNumber] = useState("");
  const [paymentPhase, setPaymentPhase] = useState<PaymentPhase>("idle");
  const [payableAmount, setPayableAmount] = useState<number | null>(null);

  const paymentPhaseLabel: Record<PaymentPhase, string> = {
    idle: "Ready to pay",
    creating_job: "Creating print job",
    creating_order: "Creating payment order",
    opening_checkout: "Opening Razorpay checkout",
    verifying_payment: "Verifying payment",
    reconciling: "Reconciling payment status",
    failed: "Payment failed",
  };

  const resetFlow = () => {
    setStep("intro");
    setFile(null);
    setUploadedFileId("");
    setFilePages(1);
    setCopies(1);
    setColor(false);
    setDoubleSided(false);
    setPaperSize(paperOptions[0] ?? "A4");
    setBinding(bindingOptions.find((item) => item.id === "none")?.id ?? "none");
    setCreatedJobId("");
    setCreatedJobNumber("");
    setPaymentPhase("idle");
    setPayableAmount(null);
  };

  useEffect(() => {
    const preferredShopId = searchParams.get("shopId");
    void getAllShops()
      .then((data) => {
        setShops(data);
        if (
          preferredShopId &&
          data.some((shop) => shop.id === preferredShopId)
        ) {
          setShopId(preferredShopId);
          return;
        }
        if (data[0]?.id) setShopId(data[0].id);
      })
      .catch((e) => setError((e as Error).message || "Failed to load shops"));
  }, [searchParams]);

  useEffect(() => {
    if (!shopId) return;
    void getShopPricing(shopId)
      .then((data) => {
        const normalized = normalizePricing(data);
        setPricing(normalized);
        setPaperSize(
          normalized.paperPricing.find((item) => item.enabled)?.paperSize ??
            "A4",
        );
        setBinding(
          normalized.bindings.find((item) => item.enabled)?.id ?? "none",
        );
        setPricingLoadError("");
      })
      .catch(() => {
        const fallback = defaultPricing();
        setPricing(fallback);
        setPaperSize("A4");
        setBinding("none");
        setPricingLoadError(
          "Live shop pricing unavailable. Using default estimate.",
        );
      });
  }, [shopId]);

  const paperOptions = useMemo(
    () =>
      pricing?.paperPricing
        ?.filter((item) => item.enabled)
        .map((item) => item.paperSize) ?? ["A4"],
    [pricing],
  );
  const bindingOptions = useMemo(
    () => pricing?.bindings?.filter((item) => item.enabled) ?? [],
    [pricing],
  );

  const selectedPaper = useMemo(
    () =>
      pricing.paperPricing.find((item) => item.paperSize === paperSize) ??
      pricing.paperPricing[0],
    [pricing.paperPricing, paperSize],
  );

  const selectedBinding = useMemo(
    () =>
      pricing.bindings.find((item) => item.id === binding) ??
      pricing.bindings.find((item) => item.id === "none") ??
      pricing.bindings[0],
    [pricing.bindings, binding],
  );

  const estimate = useMemo(() => {
    const tier: TieredRate = color ? selectedPaper.color : selectedPaper.bw;
    const totalSheets = Math.max(0, filePages * copies);
    const firstBand = Math.min(totalSheets, Math.max(0, tier.firstNPages));
    const remaining = Math.max(0, totalSheets - firstBand);
    const basePrintCost =
      firstBand * tier.firstNRate + remaining * tier.afterNRate;
    const discountedPrintCost = applyDoubleSidedDiscount(
      basePrintCost,
      selectedPaper.doubleSidedDiscountPercent,
      doubleSided,
    );
    const bindingFee =
      selectedBinding?.id === "none" ? 0 : Number(selectedBinding?.price ?? 0);

    const total = discountedPrintCost + bindingFee;

    return {
      tier,
      basePrintCost,
      discountedPrintCost,
      bindingFee,
      total,
      totalSheets,
      bindingLabel: selectedBinding?.label ?? "None",
    };
  }, [color, copies, doubleSided, filePages, selectedBinding, selectedPaper]);

  const onPickFile = async (nextFile: File | null) => {
    setError("");
    setStatus("");
    if (!nextFile) {
      setFile(null);
      setUploadedFileId("");
      return;
    }

    const fileError = validateFile(nextFile);
    if (fileError) {
      setFile(null);
      setError(fileError);
      return;
    }

    setIsUploading(true);
    setFile(nextFile);
    setCreatedJobId("");
    setCreatedJobNumber("");
    setPayableAmount(null);
    try {
      const uploaded = await uploadDocument(nextFile);
      setUploadedFileId(uploaded.id);
      setFilePages(
        Number(uploaded.pageCount) > 0 ? Number(uploaded.pageCount) : 1,
      );
      setStatus("Document uploaded and ready for configuration.");
      setStep("configure");
    } catch (e) {
      setFile(null);
      setUploadedFileId("");
      setError((e as Error).message || "Unable to upload selected file.");
      setStatus("");
    } finally {
      setIsUploading(false);
    }
  };

  const proceedToPayment = () => {
    if (!file) {
      setError("Please upload a document before continuing.");
      return;
    }
    setError("");
    setStep("payment");
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setStatus("");
    if (!file || !shopId || !selectedPaper || !uploadedFileId) {
      setError("Select a shop and document first.");
      return;
    }

    const selectedShop = shops.find((shop) => shop.id === shopId);
    if (!selectedShop?.isActive) {
      setError(
        "Selected shop is currently offline. Please choose an online shop.",
      );
      return;
    }

    if (!env.razorpayKeyId) {
      setError(
        "Razorpay is not configured. Set VITE_RAZORPAY_KEY_ID and restart the app.",
      );
      return;
    }

    setIsSubmitting(true);
    let currentOrderId = "";
    try {
      let currentJobId = createdJobId;
      let currentJobNumber = createdJobNumber;

      setPaymentPhase("creating_job");
      setStatus("Creating print job...");

      if (!currentJobId) {
        const printJob = await createPrintJob({
          shopId,
          fileId: uploadedFileId,
          totalPages: filePages,
          printOptions: {
            copies,
            color,
            doubleSided,
            paperSize,
            binding: binding || undefined,
          },
        });
        currentJobId = printJob.id;
        currentJobNumber = printJob.jobNumber;
        setCreatedJobId(printJob.id);
        setCreatedJobNumber(printJob.jobNumber);
      }

      setPaymentPhase("creating_order");
      setStatus("Creating payment order...");
      const order = await createPaymentOrder(currentJobId);
      currentOrderId = order.orderId;
      if (typeof order.totalAmount === "number") {
        setPayableAmount(order.totalAmount);
      }

      setPaymentPhase("opening_checkout");
      setStatus("Opening Razorpay checkout...");
      await ensureRazorpayLoaded();

      const paymentResult = await openRazorpayCheckout({
        key: env.razorpayKeyId,
        amount: order.amount,
        currency: order.currency || "INR",
        name: env.razorpayMerchantName || "PrintQ",
        description: `Print order ${currentJobNumber || order.jobNumber || "PrintQ"}`,
        orderId: order.orderId,
        prefill: {
          name: [user?.firstName, user?.lastName].filter(Boolean).join(" "),
          email: user?.email,
          contact: user?.phone,
        },
        notes: {
          shopId,
          shopName: selectedShop.name,
          fileName: file.name,
        },
      });

      setPaymentPhase("verifying_payment");
      setStatus("Verifying payment...");
      await verifyPayment({
        razorpayOrderId: paymentResult.razorpay_order_id,
        razorpayPaymentId: paymentResult.razorpay_payment_id,
        razorpaySignature: paymentResult.razorpay_signature,
      });

      setStatus("Payment successful. Your print request is now in queue.");
      resetFlow();
      navigate("/orders");
    } catch (e) {
      const message = (e as Error).message || "Payment failed";
      const isCancelled = message.toLowerCase().includes("dismissed");
      const canReconcile = Boolean(currentOrderId) && !isCancelled;

      if (canReconcile) {
        try {
          setPaymentPhase("reconciling");
          setStatus("Reconciling payment status...");
          const reconciled = await reconcilePayment(currentOrderId);
          const payment =
            reconciled.payment ?? (await getPaymentByOrderId(currentOrderId));
          if (payment.status === "captured") {
            setStatus("Payment confirmed. Your print request is now in queue.");
            resetFlow();
            navigate("/orders");
            return;
          }
        } catch {
          // fall through and show the original failure message
        }
      }

      setPaymentPhase("failed");
      setStatus("");
      if (isCancelled) {
        setError("Payment was cancelled in Razorpay checkout.");
      } else {
        setError(message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isUploading) {
    return (
      <section className="page-animate print-page">
        <div className="loader-screen">
          <PrinterLoading />
        </div>
      </section>
    );
  }

  return (
    <section className="page-animate print-page">
      <div className="print-header animate-rise delay-1">
        <h2>Print Flow</h2>
        <p className="print-header-subtitle">
          Fast, easy, and reliable printing
        </p>
      </div>

      {step === "intro" ? (
        <article className="card print-process-card animate-rise delay-2">
          <div className="process-header">
            <h3>How It Works</h3>
            <p className="process-subtitle">
              Complete your print job in 3 simple steps
            </p>
          </div>

          <div className="steps-container">
            <button
              type="button"
              className="step-card step-1 animate-rise"
              style={{ animationDelay: "100ms" }}
              onClick={() => setStep("upload")}
            >
              <div className="step-number">1</div>
              <h4>Upload</h4>
              <p>Choose your document (PDF, DOC, DOCX)</p>
            </button>

            <div className="step-arrow">→</div>

            <button
              type="button"
              className="step-card step-2 animate-rise"
              style={{ animationDelay: "150ms" }}
              onClick={() => setStep("upload")}
            >
              <div className="step-number">2</div>
              <h4>Configure</h4>
              <p>Pick size, color & binding options</p>
            </button>

            <div className="step-arrow">→</div>

            <button
              type="button"
              className="step-card step-3 animate-rise"
              style={{ animationDelay: "200ms" }}
              onClick={() => setStep("upload")}
            >
              <div className="step-number">3</div>
              <h4>Confirm</h4>
              <p>Review & create your print job</p>
            </button>
          </div>

          <button
            className="btn-primary btn-start-flow"
            type="button"
            onClick={() => setStep("upload")}
          >
            <span>Start Upload</span>
            <span aria-hidden="true" className="btn-start-flow-arrow">
              ↑
            </span>
          </button>
        </article>
      ) : null}

      {step !== "intro" ? (
        <form
          className="card form animate-rise delay-3 print-flow-form"
          onSubmit={onSubmit}
        >
          {step === "upload" ? (
            <div className="upload-section animate-rise delay-1">
              <div
                className={`upload-zone ${file ? "has-file" : ""}`}
                onClick={() => {
                  const fileInput = document.querySelector(
                    ".file-input-upload",
                  ) as HTMLInputElement;
                  if (fileInput) fileInput.click();
                }}
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.add("dragging");
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove("dragging");
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove("dragging");
                  const dropped = e.dataTransfer.files?.[0] ?? null;
                  void onPickFile(dropped);
                }}
              >
                {file ? (
                  <div className="file-preview">
                    <div className="file-icon">📄</div>
                    <h4>{file.name}</h4>
                    <p className="file-size">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                    <button
                      className="btn-change-file"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const fileInput = document.querySelector(
                          ".file-input-upload",
                        ) as HTMLInputElement;
                        if (fileInput) fileInput.click();
                      }}
                    >
                      ✏️ Change File
                    </button>
                  </div>
                ) : (
                  <div className="upload-prompt">
                    <div className="upload-icon">📤</div>
                    <h4>Drop your file here</h4>
                    <p className="upload-subtitle">or click to browse</p>
                    <p className="file-hints">PDF, DOC, DOCX • Max 50MB</p>
                  </div>
                )}

                <input
                  type="file"
                  className="file-input-upload"
                  style={{ display: "none" }}
                  accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(e) => {
                    const selected = e.target.files?.[0] ?? null;
                    void onPickFile(selected);
                  }}
                />
              </div>

              {!file ? (
                <div
                  className="upload-notes-panel"
                  role="note"
                  aria-label="Important upload notes"
                >
                  <p className="upload-points-title">
                    Important before upload:
                  </p>
                  <ul>
                    <li>
                      Document will not format automatically. Make sure layout
                      is final.
                    </li>
                    <li>
                      Check margins, page size, and line spacing before upload.
                    </li>
                    <li>Export to PDF for best print consistency.</li>
                  </ul>
                </div>
              ) : null}

              {file ? (
                <button
                  className="btn-primary btn-next-step"
                  type="button"
                  onClick={() => setStep("configure")}
                >
                  <span>Continue to Configure</span>
                  <span aria-hidden="true" className="btn-next-step-arrow">
                    →
                  </span>
                </button>
              ) : null}
            </div>
          ) : null}

          {step === "configure" || step === "payment" ? (
            <>
              {/* Print Options */}
              <div className="print-options-section animate-rise delay-2">
                <h3 className="section-title">Print Settings</h3>

                {/* Copies and Paper Size Row */}
                <div className="options-row">
                  <div className="option-card">
                    <label className="option-label">📄 Copies</label>
                    <div className="number-input-group">
                      <button
                        type="button"
                        onClick={() => setCopies(Math.max(1, copies - 1))}
                        className="number-btn"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min={1}
                        value={copies}
                        onChange={(e) =>
                          setCopies(Math.max(1, Number(e.target.value) || 1))
                        }
                        className="number-display"
                      />
                      <button
                        type="button"
                        onClick={() => setCopies(copies + 1)}
                        className="number-btn"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div className="option-card">
                    <label className="option-label">📏 Paper Size</label>
                    <div className="option-select-shell">
                      <select
                        value={paperSize}
                        onChange={(e) => setPaperSize(e.target.value)}
                        className="option-select"
                      >
                        {paperOptions.map((size) => (
                          <option key={size} value={size}>
                            {size}
                          </option>
                        ))}
                      </select>
                      <span className="option-select-arrow" aria-hidden="true">
                        ▾
                      </span>
                    </div>
                  </div>

                  <div className="option-card">
                    <label className="option-label">📎 Binding</label>
                    <div className="option-select-shell">
                      <select
                        value={binding}
                        onChange={(e) => setBinding(e.target.value)}
                        className="option-select"
                      >
                        <option value="none">None</option>
                        {bindingOptions.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                      <span className="option-select-arrow" aria-hidden="true">
                        ▾
                      </span>
                    </div>
                  </div>
                </div>

                {/* Toggle Options */}
                <div className="toggle-options">
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={color}
                      onChange={(e) => setColor(e.target.checked)}
                      className="toggle-input"
                    />
                    <div className="toggle-content">
                      <span className="toggle-check" aria-hidden="true" />
                      <span className="toggle-icon">🎨</span>
                      <div className="toggle-text">
                        <h4>Color Print</h4>
                        <p>Print in full color</p>
                      </div>
                    </div>
                  </label>

                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={doubleSided}
                      onChange={(e) => setDoubleSided(e.target.checked)}
                      className="toggle-input"
                    />
                    <div className="toggle-content">
                      <span className="toggle-check" aria-hidden="true" />
                      <span
                        className="toggle-icon toggle-icon-svg"
                        aria-hidden="true"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <rect
                            x="5"
                            y="3"
                            width="11"
                            height="14"
                            rx="2"
                            stroke="currentColor"
                            strokeWidth="1.8"
                          />
                          <path
                            d="M10 7H13.5"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                          />
                          <path
                            d="M10 10H14"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                          />
                          <rect
                            x="8"
                            y="7"
                            width="11"
                            height="14"
                            rx="2"
                            fill="white"
                            stroke="currentColor"
                            strokeWidth="1.8"
                          />
                          <path
                            d="M13 11H16.5"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                          />
                          <path
                            d="M13 14H17"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                          />
                        </svg>
                      </span>
                      <div className="toggle-text">
                        <h4>Double Sided</h4>
                        <p>Print on both sides</p>
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Pricing Breakdown */}
              <article className="print-estimate-card animate-rise delay-3">
                <div className="estimate-header">
                  <h3>💰 Cost Estimate</h3>
                  <p className="estimate-subtitle">File: {filePages} pages</p>
                </div>

                <div className="estimate-breakdown">
                  <div className="breakdown-row">
                    <span className="breakdown-label">Total sheets</span>
                    <span className="breakdown-value">
                      {estimate.totalSheets}
                    </span>
                  </div>

                  {doubleSided &&
                    selectedPaper.doubleSidedDiscountPercent > 0 && (
                      <div className="breakdown-row discount">
                        <span className="breakdown-label">
                          Double-sided discount
                        </span>
                        <span className="breakdown-value discount-badge">
                          -
                          <span>
                            {selectedPaper.doubleSidedDiscountPercent}%
                          </span>
                        </span>
                      </div>
                    )}

                  <div className="breakdown-row">
                    <span className="breakdown-label">Print cost</span>
                    <span className="breakdown-value price">
                      Rs {estimate.discountedPrintCost.toFixed(2)}
                    </span>
                  </div>

                  <div className="breakdown-row">
                    <span className="breakdown-label">
                      Binding ({estimate.bindingLabel})
                    </span>
                    <span className="breakdown-value price">
                      Rs {estimate.bindingFee.toFixed(2)}
                    </span>
                  </div>

                  <div className="breakdown-row">
                    <span className="breakdown-label">Platform fee</span>
                    <span className="breakdown-value price">
                      Included at payment
                    </span>
                  </div>

                  <div className="breakdown-row">
                    <span className="breakdown-label">Payment gateway fee</span>
                    <span className="breakdown-value price">
                      Included at payment
                    </span>
                  </div>

                  <div className="breakdown-divider" />

                  <div className="breakdown-row total">
                    <span className="breakdown-label">Total Amount</span>
                    <span className="breakdown-value total-amount">
                      Rs {estimate.total.toFixed(2)}
                    </span>
                  </div>
                </div>

                {pricingLoadError && (
                  <p className="error-message">{pricingLoadError}</p>
                )}
              </article>
            </>
          ) : null}

          {step === "configure" ? (
            <button
              className="btn-primary"
              type="button"
              onClick={proceedToPayment}
            >
              Proceed to Confirm
            </button>
          ) : null}

          {step === "payment" ? (
            <>
              <p className="print-feedback print-feedback-success">
                Payment status: {paymentPhaseLabel[paymentPhase]}
                {payableAmount !== null
                  ? ` | Payable amount: Rs ${payableAmount.toFixed(2)}`
                  : ""}
              </p>
              <button
                className="btn-primary"
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Processing payment..." : "Pay with Razorpay"}
              </button>
            </>
          ) : null}

          {status ? (
            <p className="print-feedback print-feedback-success">{status}</p>
          ) : null}
          {error ? (
            <p className="print-feedback print-feedback-error">{error}</p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
