import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/auth-context";
import { useLocation } from "react-router-dom";
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
import { getShopPrinters } from "../../services/api/printersApi";
import { getTokenBundle } from "../../services/storage/tokenStorage";
import {
  connectShopStatusSocket,
  ShopStatusChangedPayload,
  ShopStatusSnapshotPayload,
} from "../../services/realtime/shopStatusSocket";
import {
  PrintShop,
  ShopPricingConfig,
  TieredRate,
} from "../../shared/types/shop";
import { BackButton } from "../../shared/ui/BackButton";
import type { Socket } from "socket.io-client";

type PrintStep = "intro" | "upload" | "configure" | "payment";
type PaymentPhase =
  | "idle"
  | "creating_job"
  | "creating_order"
  | "opening_checkout"
  | "verifying_payment"
  | "reconciling"
  | "failed";

const DUPLICATE_FILE_WARNING =
  "This file is already uploaded. If you want multiple copies, continue to configuration and increase the copies setting.";

type PrintPageLocationState = {
  resumeFromPreview?: boolean;
  files?: File[];
  previewIndex?: number;
};

const RAZORPAY_CHECKOUT_URL = "https://checkout.razorpay.com/v1/checkout.js";
const RAZORPAY_CHECKOUT_TIMEOUT_MS = 120000;

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

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
  timeoutMs?: number;
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

    const timeoutMs =
      Number(options.timeoutMs) > 0
        ? Number(options.timeoutMs)
        : RAZORPAY_CHECKOUT_TIMEOUT_MS;
    let settled = false;
    const checkoutTimeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Razorpay checkout timeout"));
    }, timeoutMs);

    const resolveOnce = (response: {
      razorpay_order_id: string;
      razorpay_payment_id: string;
      razorpay_signature: string;
    }) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(checkoutTimeout);
      resolve(response);
    };

    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(checkoutTimeout);
      reject(error);
    };

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
      handler: (response) => resolveOnce(response),
      modal: {
        ondismiss: () => rejectOnce(new Error("Razorpay checkout dismissed")),
      },
    });

    checkout.on("payment.failed", (response) => {
      const reason =
        response?.error?.description ||
        response?.error?.reason ||
        response?.error?.code ||
        "Payment could not be completed in Razorpay.";
      reject(new Error(reason));
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
  const allowedDocMimeTypes = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/jpeg",
    "image/png",
  ];
  const allowedDocExtensions = new Set(["pdf", "doc", "docx"]);
  const allowedImageExtensions = new Set([
    "jpg",
    "jpeg",
    "jpf",
    "png",
    "webp",
    "gif",
    "bmp",
    "heic",
    "heif",
    "avif",
    "img",
  ]);
  const maxBytes = 50 * 1024 * 1024;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const isAllowedMimeType = allowedDocMimeTypes.includes(file.type);
  const isAllowedDocExtension = allowedDocExtensions.has(extension);
  const isAllowedImageExtension = allowedImageExtensions.has(extension);

  if (!isAllowedMimeType && !isAllowedDocExtension && !isAllowedImageExtension) {
    return "Only PDF, DOC, DOCX, JPG, and PNG files are supported.";
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function getFileSignature(file: File): string {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function isPrinterOperational(status: unknown): boolean {
  const normalized = String(status ?? "")
    .trim()
    .toLowerCase();

  if (!normalized) {
    return true;
  }

  const offlineHints = [
    "offline",
    "unavailable",
    "disconnected",
    "paused",
    "stopped",
    "maintenance",
    "error",
  ];
  if (offlineHints.some((hint) => normalized.includes(hint))) {
    return false;
  }

  const onlineHints = [
    "online",
    "busy",
    "idle",
    "ready",
    "printing",
    "active",
    "warming",
    "wakeup",
  ];

  return onlineHints.some((hint) => normalized.includes(hint));
}

function supportsRequestedPaperSize(
  availablePaperSizes: string[] | undefined,
  selectedPaperSize: string,
): boolean {
  if (!Array.isArray(availablePaperSizes) || availablePaperSizes.length === 0) {
    return true;
  }

  const normalizedSelected = String(selectedPaperSize)
    .trim()
    .toUpperCase();

  return availablePaperSizes.some(
    (size) => String(size).trim().toUpperCase() === normalizedSelected,
  );
}

function dedupeFiles(
  existingFiles: File[],
  candidateFiles: File[],
): { uniqueFiles: File[]; duplicateCount: number } {
  const seen = new Set(existingFiles.map(getFileSignature));
  const uniqueFiles: File[] = [];
  let duplicateCount = 0;

  for (const file of candidateFiles) {
    const signature = getFileSignature(file);
    if (seen.has(signature)) {
      duplicateCount += 1;
      continue;
    }

    seen.add(signature);
    uniqueFiles.push(file);
  }

  return { uniqueFiles, duplicateCount };
}

export function PrintPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [shops, setShops] = useState<PrintShop[]>([]);
  const [shopId, setShopId] = useState("");
  const [step, setStep] = useState<PrintStep>("intro");
  const [pricing, setPricing] = useState<ShopPricingConfig>(defaultPricing());
  const [pricingLoadError, setPricingLoadError] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [filePages, setFilePages] = useState(1);
  const [copies, setCopies] = useState(1);
  const [color, setColor] = useState(false);
  const [doubleSided, setDoubleSided] = useState(false);
  const [paperSize, setPaperSize] = useState("A4");
  const [binding, setBinding] = useState("none");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [paymentPhase, setPaymentPhase] = useState<PaymentPhase>("idle");
  const [payableAmount, setPayableAmount] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewIndex, setPreviewIndex] = useState(0);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [leaveWarningOpen, setLeaveWarningOpen] = useState(false);
  const [duplicateWarningOpen, setDuplicateWarningOpen] = useState(false);
  const [shopOnlineMap, setShopOnlineMap] = useState<Record<string, boolean>>(
    {},
  );
  const socketRef = useRef<Socket | null>(null);

  const statusIsWarning = status.toLowerCase().includes("already uploaded");

  const activePreviewFile = files[previewIndex] ?? files[0] ?? null;

  const showDuplicateFileWarning = () => {
    setStatus(DUPLICATE_FILE_WARNING);
    setDuplicateWarningOpen(true);
  };

  const paymentPhaseLabel: Record<PaymentPhase, string> = {
    idle: "Ready to pay",
    creating_job: "Uploading documents and creating print job",
    creating_order: "Creating payment order",
    opening_checkout: "Opening Razorpay checkout",
    verifying_payment: "Verifying payment",
    reconciling: "Reconciling payment status",
    failed: "Payment failed",
  };

  useEffect(() => {
    if (!activePreviewFile) {
      setPreviewUrl("");
      return;
    }

    const nextUrl = URL.createObjectURL(activePreviewFile);
    setPreviewUrl(nextUrl);

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [activePreviewFile]);

  useEffect(() => {
    if (files.length === 0) {
      setPreviewIndex(0);
      return;
    }
    if (previewIndex >= files.length) {
      setPreviewIndex(files.length - 1);
    }
  }, [files, previewIndex]);

  useEffect(() => {
    const locationState = location.state as PrintPageLocationState | null;
    if (!locationState?.resumeFromPreview) {
      return;
    }

    const restoredFiles = Array.isArray(locationState.files)
      ? locationState.files
      : [];

    setStep("upload");

    if (restoredFiles.length > 0) {
      setFiles(restoredFiles);
      const requestedIndex = locationState.previewIndex ?? 0;
      const boundedIndex = Math.max(
        0,
        Math.min(requestedIndex, restoredFiles.length - 1),
      );
      setPreviewIndex(boundedIndex);
    }

    navigate(`${location.pathname}${location.search}`, {
      replace: true,
      state: null,
    });
  }, [location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    let mounted = true;

    const startSocket = async () => {
      const bundle = await getTokenBundle();
      if (!bundle?.accessToken || !mounted) return;

      const socket = connectShopStatusSocket(bundle.accessToken);
      socketRef.current = socket;

      socket.on("connect", () => {
        socket.emit("status:subscribe", {});
      });

      socket.on(
        "shops:status-snapshot",
        (payload: ShopStatusSnapshotPayload) => {
          if (!mounted) return;
          const next = payload.shops.reduce<Record<string, boolean>>(
            (acc, item) => {
              acc[item.shopId] = item.isOnline;
              return acc;
            },
            {},
          );
          setShopOnlineMap(next);
        },
      );

      socket.on("shop:status-changed", (payload: ShopStatusChangedPayload) => {
        if (!mounted) return;
        setShopOnlineMap((prev) => ({
          ...prev,
          [payload.shopId]: payload.isOnline,
        }));
      });
    };

    void startSocket();

    return () => {
      mounted = false;
      socketRef.current?.emit("status:unsubscribe");
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  const resetFlow = () => {
    setStep("intro");
    setFiles([]);
    setPreviewIndex(0);
    setFilePages(1);
    setCopies(1);
    setColor(false);
    setDoubleSided(false);
    setPaperSize(paperOptions[0] ?? "A4");
    setBinding(bindingOptions.find((item) => item.id === "none")?.id ?? "none");
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

  const selectedPrintModeLabel = color ? "Color" : "Black & White";

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

  const onPickFiles = async (nextFiles: File[]) => {
    setError("");
    setStatus("");
    if (!nextFiles.length) {
      setFiles([]);
      return;
    }

    for (const candidate of nextFiles) {
      const fileError = validateFile(candidate);
      if (fileError) {
        setFiles([]);
        setError(fileError);
        return;
      }
    }

    const { uniqueFiles, duplicateCount } = dedupeFiles(files, nextFiles);
    if (duplicateCount > 0 && uniqueFiles.length === 0 && files.length > 0) {
      showDuplicateFileWarning();
      return;
    }

    setFiles(uniqueFiles.length > 0 ? uniqueFiles : nextFiles);
    setPreviewIndex(0);
    setPayableAmount(null);
    setFilePages(
      Math.max(1, (uniqueFiles.length > 0 ? uniqueFiles : nextFiles).length),
    );
    if (duplicateCount > 0) {
      showDuplicateFileWarning();
      return;
    }
    setStatus("");
  };

  const onAppendFiles = async (extraFiles: File[]) => {
    setError("");
    setStatus("");
    if (!extraFiles.length) return;

    for (const candidate of extraFiles) {
      const fileError = validateFile(candidate);
      if (fileError) {
        setError(fileError);
        return;
      }
    }

    setFiles((prev) => {
      const { uniqueFiles, duplicateCount } = dedupeFiles(prev, extraFiles);
      const merged = [...prev, ...uniqueFiles];
      setFilePages(Math.max(1, merged.length));
      if (duplicateCount > 0) {
        showDuplicateFileWarning();
      } else {
        setStatus("");
      }
      return merged;
    });
  };

  const proceedToPayment = () => {
    if (!files.length) {
      setError("Please select at least one document before continuing.");
      return;
    }
    setError("");
    setStep("payment");
  };

  const removeFileAtIndex = (indexToRemove: number) => {
    setError("");
    setStatus("");
    setFiles((prev) => {
      if (indexToRemove < 0 || indexToRemove >= prev.length) return prev;
      const next = prev.filter((_, index) => index !== indexToRemove);
      setFilePages(Math.max(1, next.length));
      if (next.length === 0) {
        setStep("upload");
        setStatus("");
      } else {
        setStatus("");
      }
      return next;
    });
  };

  const moveFile = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setFiles((prev) => {
      if (
        fromIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex < 0 ||
        toIndex >= prev.length
      ) {
        return prev;
      }

      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);

      setPreviewIndex((current) => {
        if (current === fromIndex) return toIndex;
        if (fromIndex < toIndex && current > fromIndex && current <= toIndex) {
          return current - 1;
        }
        if (toIndex < fromIndex && current >= toIndex && current < fromIndex) {
          return current + 1;
        }
        return current;
      });

      setStatus("");
      return next;
    });
  };

  const handleDropOnIndex = (dropIndex: number) => {
    if (dragIndex === null) return;
    moveFile(dragIndex, dropIndex);
    setDragIndex(null);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setStatus("");
    if (!files.length || !shopId || !selectedPaper) {
      setError("Select a shop and at least one document first.");
      return;
    }

    const selectedShop = shops.find((shop) => shop.id === shopId);
    if (!selectedShop) {
      setError("Selected shop was not found. Please reselect a shop.");
      return;
    }
    const selectedShopIsOnline = shopOnlineMap[shopId] ?? selectedShop.isActive;
    if (!selectedShopIsOnline) {
      setError(
        "Selected shop is currently offline. Please choose an online shop.",
      );
      return;
    }

    setStatus("Checking shop and printer availability...");
    const shopPrinters = await getShopPrinters(shopId);
    const onlinePrinters = shopPrinters.filter((printer) =>
      isPrinterOperational(printer.status),
    );
    const hasOnlinePrinter = onlinePrinters.length > 0;

    const hasEligiblePrinterForSelection = onlinePrinters.some((printer) => {
      if (color && printer.supportsColor === false) return false;
      if (doubleSided && printer.supportsDoubleSided === false) return false;
      if (!supportsRequestedPaperSize(printer.paperSizes, paperSize)) return false;
      return true;
    });

    const manualWork = color || !hasOnlinePrinter || !hasEligiblePrinterForSelection;

    if (manualWork) {
      setStatus(
        hasOnlinePrinter
          ? "No suitable printer is available for these options. This job will be created as manual work."
          : "No printer is currently online. This job will be created as manual work.",
      );
    }

    if (!env.razorpayKeyId) {
      setError(
        "Razorpay is not configured. Set RAZORPAY_KEY_ID and restart the app.",
      );
      return;
    }

    if (
      env.razorpayKeyId.startsWith("rzp_test_") &&
      !isLocalHost(window.location.hostname) &&
      !env.allowRazorpayTestModeOnNonLocal
    ) {
      setError(
        "Payments are in Razorpay test mode on a non-local host. Use LIVE Razorpay keys in frontend and backend for real payments.",
      );
      return;
    }

    setIsSubmitting(true);
    let currentOrderId = "";
    let createdJobId = "";
    let createdJobNumber = "";
    let uploadedFiles: Array<{
      id: string;
      fileName: string;
      pageCount: number;
    }> | null = null;
    let resolvedPages = filePages;

    const createPendingPaymentJob = async () => {
      setPaymentPhase("creating_job");
      setStatus("Uploading documents and creating print job...");

      if (!uploadedFiles) {
        uploadedFiles = [];
        for (const currentFile of files) {
          const uploaded = await uploadDocument(currentFile);
          const pageCount =
            Number(uploaded.pageCount) > 0 ? Number(uploaded.pageCount) : 1;
          uploadedFiles.push({
            id: uploaded.id,
            fileName: currentFile.name,
            pageCount,
          });
        }

        resolvedPages = uploadedFiles.reduce(
          (sum, item) => sum + item.pageCount,
          0,
        );
        setFilePages(resolvedPages);
      }

      const primaryFileId = uploadedFiles?.[0]?.id;
      if (!primaryFileId) {
        throw new Error("No files were uploaded. Please try again.");
      }

      const createdJob = await createPrintJob({
        shopId,
        fileId: primaryFileId,
        totalPages: resolvedPages,
        printOptions: {
          copies,
          color,
          manualWork,
          doubleSided,
          paperSize,
          binding: binding || undefined,
          documentQueue: uploadedFiles.map((item) => ({
            fileId: item.id,
            fileName: item.fileName,
            pageCount: item.pageCount,
            copies,
          })),
        },
      });

      createdJobId = createdJob.id;
      createdJobNumber = createdJob.jobNumber;
    };

    try {
      await createPendingPaymentJob();

      setPaymentPhase("creating_order");
      setStatus("Creating payment order...");
      const order = await createPaymentOrder({
        printJobId: createdJobId,
      });
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
        description: `Print order ${createdJobNumber || order.jobNumber || "PrintQ"}`,
        orderId: order.orderId,
        prefill: {
          name: [user?.firstName, user?.lastName].filter(Boolean).join(" "),
          email: user?.email,
          contact: user?.phone,
        },
        notes: {
          shopId,
          shopName: selectedShop.name,
          fileName:
            files.length === 1 ? files[0].name : `${files.length} files`,
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
      const normalizedMessage = message.toLowerCase();
      const isCheckoutTimeout = normalizedMessage.includes("timeout");
      const isCancelled =
        normalizedMessage.includes("dismissed") ||
        normalizedMessage.includes("cancel") ||
        normalizedMessage.includes("closed");
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

          if (isCheckoutTimeout) {
            setPaymentPhase("idle");
            setStatus("");
            setError(
              "Checkout timed out and payment is not captured yet. Please retry in a moment.",
            );
            return;
          }
        } catch {
          if (isCheckoutTimeout) {
            setPaymentPhase("idle");
            setStatus("");
            setError(
              "Checkout timed out. Payment status is unknown. Please check Orders before retrying.",
            );
            return;
          }
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

  const handleBackClick = () => {
    if (step === "payment") {
      setStep("configure");
      return;
    }

    if (step === "configure") {
      setStep("upload");
      return;
    }

    if (step === "upload") {
      if (files.length > 0) {
        setLeaveWarningOpen(true);
        return;
      }
      if (window.history.length > 1) {
        navigate(-1);
        return;
      }
      navigate("/");
      return;
    }

    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate("/");
  };

  const confirmLeavePrintFlow = () => {
    setLeaveWarningOpen(false);
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate("/");
  };

  return (
    <section className="page-animate print-page">
      <div className="page-topbar">
        <BackButton fallbackPath="/" label="Back" onClick={handleBackClick} />
      </div>

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
              <p>Choose your file (PDF, DOC, DOCX, JPG, PNG)</p>
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
                className={`upload-zone ${files.length ? "has-file" : ""}`}
                onClick={() => {
                  if (files.length) return;
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
                  const dropped = Array.from(e.dataTransfer.files ?? []);
                  void onPickFiles(dropped);
                }}
              >
                {files.length ? (
                  <div className="file-preview">
                    <div className="file-icon">📄</div>
                    <h4>
                      {files.length === 1
                        ? files[0].name
                        : `${files.length} files selected`}
                    </h4>
                    <p className="file-size">
                      {formatFileSize(
                        files.reduce((sum, current) => sum + current.size, 0),
                      )}{" "}
                      total
                    </p>
                    {files.length > 1 ? (
                      <p className="upload-subtitle">
                        First file preview: {files[0].name}
                      </p>
                    ) : null}
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
                      ✏️ Replace Files
                    </button>
                    <button
                      className="btn-change-file"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const fileInput = document.querySelector(
                          ".file-input-add-more",
                        ) as HTMLInputElement;
                        if (fileInput) fileInput.click();
                      }}
                    >
                      ➕ Add More Files
                    </button>
                    <button
                      className="btn-change-file btn-preview-file"
                      type="button"
                      disabled={!previewUrl || !activePreviewFile}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!activePreviewFile) return;
                        navigate("/print/preview", {
                          state: {
                            fileUrl: previewUrl,
                            fileName: activePreviewFile.name,
                            mimeType: activePreviewFile.type,
                            files,
                            selectedIndex: previewIndex,
                          },
                        });
                      }}
                    >
                      👁️ See Preview File
                    </button>

                    {files.length ? (
                      <div className="selected-files-list">
                        <p className="selected-files-title">Selected files</p>
                        <p className="selected-files-help">
                          Press and hold, then drag to reorder print sequence.
                        </p>
                        <ul>
                          {files.map((item, index) => (
                            <li key={`${item.name}-${item.size}-${index}`}>
                              <button
                                type="button"
                                className={`selected-file-chip ${index === previewIndex ? "active" : ""}`}
                                draggable
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPreviewIndex(index);
                                }}
                                onDragStart={(e) => {
                                  e.stopPropagation();
                                  setDragIndex(index);
                                  e.dataTransfer.effectAllowed = "move";
                                }}
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                }}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleDropOnIndex(index);
                                }}
                                onDragEnd={() => setDragIndex(null)}
                              >
                                <span className="selected-file-name">
                                  {index + 1}. {item.name}
                                </span>
                                <span className="selected-file-meta">
                                  {formatFileSize(item.size)}
                                </span>
                              </button>
                              <div className="selected-file-actions">
                                <button
                                  type="button"
                                  className="selected-file-remove"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeFileAtIndex(index);
                                  }}
                                  aria-label={`Remove ${item.name}`}
                                >
                                  ×
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="upload-prompt">
                    <div className="upload-icon">📤</div>
                    <h4>Drop files here</h4>
                    <p className="upload-subtitle">or click to browse</p>
                    <p className="file-hints">PDF, DOC, DOCX, JPG, PNG • Max 50MB</p>
                  </div>
                )}

                <input
                  type="file"
                  className="file-input-upload"
                  style={{ display: "none" }}
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png"
                  onChange={(e) => {
                    const selected = Array.from(e.target.files ?? []);
                    void onAppendFiles(selected);
                  }}
                />
              </div>

              {!files.length ? (
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
                      Documents will not format automatically. Make sure layout
                      is final.
                    </li>
                    <li>
                      Check margins, page size, and line spacing before upload.
                    </li>
                    <li>
                      You can upload multiple files and they print in upload
                      order.
                    </li>
                  </ul>
                </div>
              ) : null}

              {files.length ? (
                <div className="upload-actions">
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
                </div>
              ) : null}
            </div>
          ) : null}

          {step === "configure" || step === "payment" ? (
            <>
              {files.length ? (
                <article className="upload-files-summary">
                  <div className="upload-files-summary-head">
                    <h3>Uploaded Documents</h3>
                    <button
                      type="button"
                      className="btn-change-file"
                      onClick={() => setStep("upload")}
                    >
                      Edit files
                    </button>
                  </div>
                  <p>
                    {files.length} file{files.length > 1 ? "s" : ""} selected (
                    {formatFileSize(
                      files.reduce((sum, current) => sum + current.size, 0),
                    )}
                    )
                  </p>
                  <ul>
                    {files.map((item, index) => (
                      <li key={`${item.name}-${item.size}-${index}`}>
                        {index + 1}. {item.name}
                      </li>
                    ))}
                  </ul>
                </article>
              ) : null}

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
                      type="radio"
                      name="printMode"
                      checked={!color}
                      onChange={() => setColor(false)}
                      className="toggle-input"
                    />
                    <div className="toggle-content">
                      <span className="toggle-check" aria-hidden="true" />
                      <span className="toggle-icon">🖨️</span>
                      <div className="toggle-text">
                        <h4>Black & White</h4>
                        <p>Monochrome print</p>
                      </div>
                    </div>
                  </label>

                  <label className="toggle-card">
                    <input
                      type="radio"
                      name="printMode"
                      checked={color}
                      onChange={() => setColor(true)}
                      className="toggle-input"
                    />
                    <div className="toggle-content">
                      <span className="toggle-check" aria-hidden="true" />
                      <span className="toggle-icon">🎨</span>
                      <div className="toggle-text">
                        <h4>Color</h4>
                        <p>Full color print</p>
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

                  <div className="breakdown-row">
                    <span className="breakdown-label">Selected mode</span>
                    <span className="breakdown-value">{selectedPrintModeLabel}</span>
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
              {paymentPhase !== "idle" ? (
                <p className="print-feedback print-feedback-success">
                  Payment status: {paymentPhaseLabel[paymentPhase]}
                  {` | Selected mode: ${selectedPrintModeLabel}`}
                  {payableAmount !== null
                    ? ` | Payable amount: Rs ${payableAmount.toFixed(2)}`
                    : ""}
                </p>
              ) : null}
              <button
                className="btn-primary"
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Processing payment..." : "Pay with Razorpay"}
              </button>
            </>
          ) : null}

          {status && !statusIsWarning ? (
            <p
              className={`print-feedback ${statusIsWarning ? "print-feedback-warning" : "print-feedback-success"}`}
            >
              {status}
            </p>
          ) : null}
          {error ? (
            <p className="print-feedback print-feedback-error">{error}</p>
          ) : null}
        </form>
      ) : null}

      {leaveWarningOpen ? (
        <div
          className="scan-modal print-leave-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="leave-warning-title"
          aria-describedby="leave-warning-description"
        >
          <article className="scan-modal-card print-leave-modal-card">
            <div className="print-leave-modal-icon">⚠️</div>
            <h3 id="leave-warning-title">Leave this page?</h3>
            <p
              id="leave-warning-description"
              className="print-leave-modal-text"
            >
              Uploaded files will not be saved if you go back. You can return
              later and upload them again.
            </p>
            <div className="print-leave-modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setLeaveWarningOpen(false)}
              >
                Stay here
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={confirmLeavePrintFlow}
              >
                Leave page
              </button>
            </div>
          </article>
        </div>
      ) : null}

      {duplicateWarningOpen ? (
        <div
          className="scan-modal print-leave-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="duplicate-warning-title"
          aria-describedby="duplicate-warning-description"
        >
          <article className="scan-modal-card print-leave-modal-card">
            <div className="print-leave-modal-icon">ℹ️</div>
            <h3 id="duplicate-warning-title">File already uploaded</h3>
            <p
              id="duplicate-warning-description"
              className="print-leave-modal-text"
            >
              {DUPLICATE_FILE_WARNING}
            </p>
            <div className="print-leave-modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setDuplicateWarningOpen(false)}
              >
                OK
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  setDuplicateWarningOpen(false);
                  setStep("configure");
                }}
              >
                Go to Configure
              </button>
            </div>
          </article>
        </div>
      ) : null}
    </section>
  );
}
