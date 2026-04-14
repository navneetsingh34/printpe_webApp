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
import { io, type Socket } from "socket.io-client";

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
  "This file is already uploaded. If you want multiple copies, continue to configuration and adjust the document or page copy count.";
const DOC_UNSUPPORTED_MESSAGE =
  "DOC/DOCX files are not supported right now. They may cause formatting issues. Please convert your file to PDF before uploading.";

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
      ? value.bindings
          .map((item) => ({
            id: item.id || "binding",
            label: item.label || "Binding",
            price: Number(item.price ?? 0) || 0,
            enabled: item.enabled !== false,
          }))
          .filter((item) => item.id !== "staple" && item.label.toLowerCase() !== "staple")
      : defaults.bindings;

  if (!bindings.some((item) => item.id === "none")) {
    bindings.unshift({ id: "none", label: "None", price: 0, enabled: true });
  }

  return { paperPricing, bindings };
}

function validateFile(file: File): string | null {
  const allowedDocMimeTypes = [
    "application/pdf",
    "image/jpeg",
    "image/png",
  ];
  const allowedDocExtensions = new Set(["pdf"]);
  const blockedWordMimeTypes = new Set([
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-word.document.macroenabled.12",
  ]);
  const blockedWordExtensions = new Set(["doc", "docx", "dot", "dotx"]);
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
  if (blockedWordMimeTypes.has(file.type) || blockedWordExtensions.has(extension)) {
    return DOC_UNSUPPORTED_MESSAGE;
  }
  const isAllowedMimeType = allowedDocMimeTypes.includes(file.type);
  const isAllowedDocExtension = allowedDocExtensions.has(extension);
  const isAllowedImageExtension = allowedImageExtensions.has(extension);

  if (!isAllowedMimeType && !isAllowedDocExtension && !isAllowedImageExtension) {
    return "Only PDF, JPG, and PNG files are supported.";
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

function normalizeCopiesValue(value: unknown, fallback = 1): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return Math.max(1, Math.floor(fallback));
  }

  return Math.max(1, Math.floor(parsed));
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

function isImageFile(file: File): boolean {
  return (
    file.type.startsWith("image/") ||
    /\.(jpg|jpeg|png|gif|webp|bmp|heic|heif|avif)$/i.test(file.name)
  );
}

function getConfiguredPageCount(
  files: File[],
  imagePageByFile: Record<string, number>,
  groupedImagePages?: number,
): number {
  if (files.length === 0) {
    return 1;
  }

  let nonImagePages = 0;
  let imageOrder = 0;
  const imagePages = new Set<number>();

  for (const file of files) {
    if (isImageFile(file)) {
      const signature = getFileSignature(file);
      const fallbackPage = Math.floor(imageOrder / 2) + 1;
      const pageNumber = Math.max(
        1,
        Math.floor(Number(imagePageByFile[signature] ?? fallbackPage) || 1),
      );
      imagePages.add(pageNumber);
      imageOrder += 1;
      continue;
    }

    // Before upload we do not have exact page count for docs, so keep 1 page per file.
    nonImagePages += 1;
  }

  if (Number.isFinite(groupedImagePages)) {
    return Math.max(1, nonImagePages + Math.max(0, Math.floor(groupedImagePages || 0)));
  }

  return Math.max(1, nonImagePages + imagePages.size);
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

type RealtimePrinterSnapshotPayload = {
  shopId: string;
  printers?: Array<{
    status?: unknown;
    supportsColor?: boolean;
    supportsDoubleSided?: boolean;
    paperSizes?: string[];
  }>;
  runtimeOnline?: boolean;
};

async function getRealtimeShopPrinters(shopId: string): Promise<
  RealtimePrinterSnapshotPayload["printers"]
> {
  const bundle = await getTokenBundle();
  if (!bundle?.accessToken) {
    throw new Error("Please sign in again to check realtime printer status.");
  }

  return new Promise((resolve, reject) => {
    const socket = io(`${env.wsBaseUrl}/companion`, {
      transports: ["websocket"],
      auth: { token: bundle.accessToken },
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 2,
      reconnectionDelay: 500,
      timeout: 8000,
    });

    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Realtime printer check timed out."));
    }, 7000);

    const cleanup = () => {
      window.clearTimeout(timeout);
      socket.off("connect", onConnect);
      socket.off("connect_error", onConnectError);
      socket.off("printers:snapshot", onSnapshot);
      socket.off("error", onSocketError);
      socket.disconnect();
    };

    const onConnect = () => {
      // Ask companion namespace to bind this session to shop runtime before snapshot.
      socket.emit("companion:connect", { shopId });
      socket.emit("printers:subscribe", { shopId });
    };

    const onConnectError = () => {
      cleanup();
      reject(new Error("Unable to connect for realtime printer check."));
    };

    const onSnapshot = (payload: RealtimePrinterSnapshotPayload) => {
      if (payload?.shopId !== shopId) return;
      cleanup();
      resolve(Array.isArray(payload.printers) ? payload.printers : []);
    };

    const onSocketError = (payload?: { message?: string }) => {
      cleanup();
      reject(
        new Error(payload?.message ?? "Realtime printer check failed."),
      );
    };

    socket.on("connect", onConnect);
    socket.on("connect_error", onConnectError);
    socket.on("printers:snapshot", onSnapshot);
    socket.on("error", onSocketError);
  });
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

type PreviewResizeHandle =
  | "move"
  | "n"
  | "s"
  | "e"
  | "w"
  | "ne"
  | "nw"
  | "se"
  | "sw"
  | "rotate";

type PreviewTransform = {
  centerXPct: number;
  centerYPct: number;
  widthPct: number;
  heightPct: number;
};

type PreviewPrintTransform = PreviewTransform & {
  rotationDeg: number;
  zoomPct: number;
};

type FilePreviewSettings = {
  transform: PreviewTransform;
  rotationDeg: number;
  zoomPct: number;
};

type ImageCompositeLayer = {
  file: File;
  fileIndex: number;
  signature: string;
  url: string;
  order: number;
  total: number;
  settings: FilePreviewSettings;
  isActive: boolean;
};

type ImagePageBucket = {
  pageNumber: number;
  signatures: string[];
};

type PreviewDragState = {
  handle: PreviewResizeHandle;
  startX: number;
  startY: number;
  startRotation: number;
  startPointerAngle: number;
  startTransform: PreviewTransform;
};

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getRotatedResizeCursor(
  handle: "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw",
  rotationDeg: number,
): React.CSSProperties["cursor"] {
  const ring: Array<"n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw"> = [
    "n",
    "ne",
    "e",
    "se",
    "s",
    "sw",
    "w",
    "nw",
  ];

  const cursorByDirection: Record<typeof ring[number], React.CSSProperties["cursor"]> = {
    n: "ns-resize",
    ne: "nesw-resize",
    e: "ew-resize",
    se: "nwse-resize",
    s: "ns-resize",
    sw: "nesw-resize",
    w: "ew-resize",
    nw: "nwse-resize",
  };

  const baseIndex = ring.indexOf(handle);
  const rotateSteps = Math.round(rotationDeg / 45);
  const rotatedIndex = ((baseIndex + rotateSteps) % ring.length + ring.length) % ring.length;
  return cursorByDirection[ring[rotatedIndex]];
}

function getRotatedHalfExtents(
  widthPct: number,
  heightPct: number,
  rotationDeg: number,
): { halfX: number; halfY: number } {
  const theta = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const halfW = widthPct / 2;
  const halfH = heightPct / 2;

  return {
    halfX: Math.abs(halfW * cos) + Math.abs(halfH * sin),
    halfY: Math.abs(halfW * sin) + Math.abs(halfH * cos),
  };
}

function getDefaultImageTransform(
  sheetRatio: number,
  imageRatio: number,
  fitMode: "fit" | "fill" | "actual",
): PreviewTransform {
  const safeSheet =
    Number.isFinite(sheetRatio) && sheetRatio > 0 ? sheetRatio : 0.707;
  const safeImage =
    Number.isFinite(imageRatio) && imageRatio > 0 ? imageRatio : 1;

  const base =
    fitMode === "actual"
      ? 52
      : fitMode === "fill"
        ? 92
        : 84;

  let widthPct = base;
  let heightPct = base;

  if (safeImage >= safeSheet) {
    heightPct = base * (safeSheet / safeImage);
  } else {
    widthPct = base * (safeImage / safeSheet);
  }

  return {
    centerXPct: 50,
    centerYPct: 50,
    widthPct: clampNumber(widthPct, 12, 96),
    heightPct: clampNumber(heightPct, 12, 96),
  };
}

function getCompositeDefaultImageTransform(
  sheetRatio: number,
  imageRatio: number,
  order: number,
  total: number,
): PreviewTransform {
  if (total <= 1) {
    return getDefaultImageTransform(sheetRatio, imageRatio, "fit");
  }

  const columns = Math.min(2, total);
  const rows = Math.ceil(total / 2);
  const col = order % columns;
  const row = Math.floor(order / columns);

  const cellWidth = 100 / columns;
  const cellHeight = 100 / rows;
  const safeSheet = Number.isFinite(sheetRatio) && sheetRatio > 0 ? sheetRatio : 0.707;
  const safeImage = Number.isFinite(imageRatio) && imageRatio > 0 ? imageRatio : 1;

  const baseWidth = Math.max(24, cellWidth * 0.84);
  const heightFromWidth = baseWidth * (safeSheet / safeImage);
  const maxHeight = Math.max(22, cellHeight * 0.84);
  const widthPct = clampNumber(baseWidth, 20, 96);
  const heightPct = clampNumber(heightFromWidth, 20, maxHeight);

  return {
    centerXPct: cellWidth * (col + 0.5),
    centerYPct: cellHeight * (row + 0.5),
    widthPct,
    heightPct,
  };
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
  const [documentCopiesByFile, setDocumentCopiesByFile] = useState<Record<string, number>>({});
  const [imageCopiesByPage, setImageCopiesByPage] = useState<Record<number, number>>({});
  const [color, setColor] = useState(false);
  const [doubleSided, setDoubleSided] = useState(false);
  const [paperSize, setPaperSize] = useState("A4");
  const [binding, setBinding] = useState("none");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadProgressLabel, setUploadProgressLabel] = useState("");
  const [paymentPhase, setPaymentPhase] = useState<PaymentPhase>("idle");
  const [payableAmount, setPayableAmount] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewFitMode, setPreviewFitMode] = useState<
    "fit" | "fill" | "actual"
  >("fit");
  const [previewZoom, setPreviewZoom] = useState(100);
  const [previewRotation, setPreviewRotation] = useState(0);
  const [previewImageAspect, setPreviewImageAspect] = useState(1);
  const [previewTransform, setPreviewTransform] = useState<PreviewTransform>({
    centerXPct: 50,
    centerYPct: 50,
    widthPct: 84,
    heightPct: 84,
  });
  const [previewSettingsByFile, setPreviewSettingsByFile] = useState<
    Record<string, FilePreviewSettings>
  >({});
  const [imagePageByFile, setImagePageByFile] = useState<Record<string, number>>(
    {},
  );
  const [selectedPreviewPage, setSelectedPreviewPage] = useState<number | null>(
    null,
  );
  const [draggingImageSignature, setDraggingImageSignature] = useState("");
  const [extraImagePages, setExtraImagePages] = useState(0);
  const [previewUrlsByFile, setPreviewUrlsByFile] = useState<
    Record<string, string>
  >({});
  const [previewImageAspectByFile, setPreviewImageAspectByFile] = useState<
    Record<string, number>
  >({});
  const [isPreviewSelected, setIsPreviewSelected] = useState(false);
  const [activePreviewHandle, setActivePreviewHandle] =
    useState<PreviewResizeHandle | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [leaveWarningOpen, setLeaveWarningOpen] = useState(false);
  const [duplicateWarningOpen, setDuplicateWarningOpen] = useState(false);
  const [shopOnlineMap, setShopOnlineMap] = useState<Record<string, boolean>>(
    {},
  );
  const socketRef = useRef<Socket | null>(null);
  const previewSheetRef = useRef<HTMLDivElement | null>(null);
  const previewDragRef = useRef<PreviewDragState | null>(null);

  const statusIsWarning = status.toLowerCase().includes("already uploaded");

  const activePreviewFile = files[previewIndex] ?? files[0] ?? null;
  const activePreviewFileSignature = activePreviewFile
    ? getFileSignature(activePreviewFile)
    : "";
  const previewFileName = activePreviewFile?.name ?? "";

  const isImagePreview = Boolean(
    activePreviewFile &&
      (activePreviewFile.type.startsWith("image/") ||
        /\.(jpg|jpeg|png|gif|webp|bmp|heic|heif|avif)$/i.test(
          previewFileName,
        )),
  );

  const isPdfPreview = Boolean(
    activePreviewFile &&
      (activePreviewFile.type === "application/pdf" ||
        /\.pdf$/i.test(previewFileName)),
  );

  const previewSheetAspectRatio =
    paperSize.toUpperCase() === "A3"
      ? 297 / 420
      : paperSize.toUpperCase() === "LETTER"
        ? 8.5 / 11
        : 210 / 297;

  const imagePreviewFiles = useMemo(
    () =>
      files
        .map((file, fileIndex) => ({ file, fileIndex }))
        .filter((entry) => isImageFile(entry.file)),
    [files],
  );

  const imagePreviewLayerList = useMemo<ImageCompositeLayer[]>(() => {
    return imagePreviewFiles
      .map(({ file, fileIndex }, order) => {
        const signature = getFileSignature(file);
        const url = previewUrlsByFile[signature] ?? "";
        const aspect = previewImageAspectByFile[signature] ?? 1;
        const isActive = signature === activePreviewFileSignature;
        const fallbackTransform = getCompositeDefaultImageTransform(
          previewSheetAspectRatio,
          aspect,
          order,
          imagePreviewFiles.length,
        );

        const settings = isActive
          ? {
              transform: previewTransform,
              rotationDeg: previewRotation,
              zoomPct: previewZoom,
            }
          : previewSettingsByFile[signature] ?? {
              transform: fallbackTransform,
              rotationDeg: 0,
              zoomPct: 100,
            };

        return {
          file,
          fileIndex,
          signature,
          url,
          order,
          total: imagePreviewFiles.length,
          settings,
          isActive,
        };
      })
      .filter((layer) => Boolean(layer.url));
  }, [
    imagePreviewFiles,
    previewUrlsByFile,
    previewImageAspectByFile,
    activePreviewFileSignature,
    previewSettingsByFile,
    previewTransform,
    previewRotation,
    previewZoom,
    previewSheetAspectRatio,
  ]);

  const imagePageBuckets = useMemo<ImagePageBucket[]>(() => {
    if (imagePreviewFiles.length === 0) {
      return [];
    }

    const grouped = new Map<number, string[]>();
    imagePreviewFiles.forEach(({ file }, order) => {
      const signature = getFileSignature(file);
      const fallbackPage = Math.floor(order / 2) + 1;
      const pageNumber = Math.max(1, imagePageByFile[signature] ?? fallbackPage);
      const list = grouped.get(pageNumber) ?? [];
      list.push(signature);
      grouped.set(pageNumber, list);
    });

    const normalized = Array.from(grouped.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([pageNumber, signatures]) => ({
        pageNumber,
        signatures,
      }));
    const maxPage =
      normalized.length > 0 ? normalized[normalized.length - 1].pageNumber : 1;

    for (let index = 1; index <= extraImagePages; index += 1) {
      normalized.push({
        pageNumber: maxPage + index,
        signatures: [],
      });
    }

    return normalized;
  }, [imagePreviewFiles, imagePageByFile, extraImagePages]);

  const selectedPageBucket = useMemo(() => {
    if (imagePageBuckets.length === 0) {
      return null;
    }

    if (selectedPreviewPage === null) {
      return imagePageBuckets[0];
    }

    return (
      imagePageBuckets.find((bucket) => bucket.pageNumber === selectedPreviewPage) ??
      imagePageBuckets[0]
    );
  }, [imagePageBuckets, selectedPreviewPage]);

  const configuredPageCount = useMemo(() => {
    const groupedImagePages = imagePageBuckets.filter(
      (bucket) => bucket.signatures.length > 0,
    ).length;
    return getConfiguredPageCount(files, imagePageByFile, groupedImagePages);
  }, [files, imagePageByFile, imagePageBuckets]);

  const filteredImagePreviewLayerList = useMemo(() => {
    if (!selectedPageBucket) {
      return imagePreviewLayerList;
    }

    const signatureSet = new Set(selectedPageBucket.signatures);
    return imagePreviewLayerList.filter((layer) =>
      signatureSet.has(layer.signature),
    );
  }, [imagePreviewLayerList, selectedPageBucket]);

  const assignImageToPage = (signature: string, pageNumber: number) => {
    const safePage = Math.max(1, Math.floor(Number(pageNumber) || 1));
    setImagePageByFile((prev) => ({
      ...prev,
      [signature]: safePage,
    }));
  };

  const addImagePageBucket = () => {
    const nextPage =
      imagePageBuckets.length > 0
        ? imagePageBuckets[imagePageBuckets.length - 1].pageNumber + 1
        : 1;
    setExtraImagePages((prev) => prev + 1);
    setSelectedPreviewPage(nextPage);
  };

  useEffect(() => {
    setFilePages(configuredPageCount);
  }, [configuredPageCount]);

  const removeImagePageBucket = (pageNumber: number) => {
    if (imagePageBuckets.length <= 1) return;

    const fallbackTarget = pageNumber > 1 ? pageNumber - 1 : 2;
    setImagePageByFile((prev) => {
      const next: Record<string, number> = {};
      Object.entries(prev).forEach(([signature, rawPage]) => {
        let page = Math.max(1, Math.floor(Number(rawPage) || 1));
        if (page === pageNumber) {
          page = fallbackTarget;
        }
        if (page > pageNumber) {
          page -= 1;
        }
        next[signature] = Math.max(1, page);
      });
      return next;
    });

    setImageCopiesByPage((prev) => {
      const next: Record<number, number> = {};

      Object.entries(prev).forEach(([rawPage, rawCopies]) => {
        let page = Math.max(1, Math.floor(Number(rawPage) || 1));
        const normalizedCopies = normalizeCopiesValue(rawCopies, copies);

        if (page === pageNumber) {
          page = fallbackTarget;
        }
        if (page > pageNumber) {
          page -= 1;
        }

        next[page] = Math.max(next[page] ?? 0, normalizedCopies);
      });

      return next;
    });

    setExtraImagePages((prev) => Math.max(0, prev - 1));
    setSelectedPreviewPage((prev) => {
      if (prev === null) return prev;
      if (prev === pageNumber) {
        return Math.max(1, pageNumber - 1);
      }
      if (prev > pageNumber) {
        return prev - 1;
      }
      return prev;
    });
  };

  const beginPreviewInteraction = (
    handle: PreviewResizeHandle,
    event: React.PointerEvent<HTMLElement>,
  ) => {
    if (!isImagePreview || !previewSheetRef.current) return;

    const rect = previewSheetRef.current.getBoundingClientRect();
    const centerX = rect.left + (previewTransform.centerXPct / 100) * rect.width;
    const centerY = rect.top + (previewTransform.centerYPct / 100) * rect.height;
    const startPointerAngle =
      (Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180) /
      Math.PI;

    previewDragRef.current = {
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startRotation: previewRotation,
      startPointerAngle,
      startTransform: { ...previewTransform },
    };

    setIsPreviewSelected(true);
    setActivePreviewHandle(handle);
    event.preventDefault();
    event.stopPropagation();
  };

  const onPreviewFramePointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (!isPreviewSelected) {
      setIsPreviewSelected(true);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    beginPreviewInteraction("move", event);
  };

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
    const nextUrls: Record<string, string> = {};
    for (const file of files) {
      const signature = getFileSignature(file);
      nextUrls[signature] = URL.createObjectURL(file);
    }

    setPreviewUrlsByFile(nextUrls);

    return () => {
      Object.values(nextUrls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [files]);

  useEffect(() => {
    let isMounted = true;
    const imageEntries = files
      .map((file) => ({ file, signature: getFileSignature(file) }))
      .filter(({ file }) => isImageFile(file));

    if (imageEntries.length === 0) {
      setPreviewImageAspectByFile({});
      return;
    }

    const pending = imageEntries.map(({ signature }) => {
      const src = previewUrlsByFile[signature];
      if (!src) {
        return Promise.resolve<[string, number]>([signature, 1]);
      }

      return new Promise<[string, number]>((resolve) => {
        const img = new window.Image();
        img.onload = () => {
          const ratio =
            img.naturalWidth > 0 && img.naturalHeight > 0
              ? img.naturalWidth / img.naturalHeight
              : 1;
          resolve([signature, ratio]);
        };
        img.onerror = () => resolve([signature, 1]);
        img.src = src;
      });
    });

    void Promise.all(pending).then((results) => {
      if (!isMounted) return;
      const next: Record<string, number> = {};
      for (const [signature, ratio] of results) {
        next[signature] = ratio;
      }
      setPreviewImageAspectByFile(next);
    });

    return () => {
      isMounted = false;
    };
  }, [files, previewUrlsByFile]);

  useEffect(() => {
    if (imagePreviewFiles.length === 0) {
      setImagePageByFile({});
      setExtraImagePages(0);
      setSelectedPreviewPage(null);
      return;
    }

    setImagePageByFile((prev) => {
      const next: Record<string, number> = {};
      imagePreviewFiles.forEach(({ file }, order) => {
        const signature = getFileSignature(file);
        const fallbackPage = Math.floor(order / 2) + 1;
        next[signature] = Math.max(1, prev[signature] ?? fallbackPage);
      });

      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (
        prevKeys.length === nextKeys.length &&
        nextKeys.every((key) => prev[key] === next[key])
      ) {
        return prev;
      }

      return next;
    });
  }, [imagePreviewFiles]);

  useEffect(() => {
    if (imagePageBuckets.length === 0) {
      setSelectedPreviewPage(null);
      return;
    }

    setSelectedPreviewPage((prev) => {
      if (
        prev !== null &&
        imagePageBuckets.some((bucket) => bucket.pageNumber === prev)
      ) {
        return prev;
      }

      return imagePageBuckets[0].pageNumber;
    });
  }, [imagePageBuckets]);

  useEffect(() => {
    setDocumentCopiesByFile((prev) => {
      const next: Record<string, number> = {};

      for (const file of files) {
        if (isImageFile(file)) {
          continue;
        }

        const signature = getFileSignature(file);
        next[signature] = normalizeCopiesValue(prev[signature] ?? copies, copies);
      }

      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (
        prevKeys.length === nextKeys.length &&
        nextKeys.every((key) => prev[key] === next[key])
      ) {
        return prev;
      }

      return next;
    });
  }, [copies, files]);

  useEffect(() => {
    setImageCopiesByPage((prev) => {
      const next: Record<number, number> = {};

      for (const bucket of imagePageBuckets) {
        next[bucket.pageNumber] = normalizeCopiesValue(prev[bucket.pageNumber] ?? copies, copies);
      }

      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next).map(Number);
      if (
        prevKeys.length === nextKeys.length &&
        nextKeys.every((key) => prev[key] === next[key])
      ) {
        return prev;
      }

      return next;
    });
  }, [copies, imagePageBuckets]);

  useEffect(() => {
    if (!isImagePreview || !previewUrl) {
      setPreviewImageAspect(1);
      return;
    }

    const img = new window.Image();
    img.onload = () => {
      const ratio =
        img.naturalWidth > 0 && img.naturalHeight > 0
          ? img.naturalWidth / img.naturalHeight
          : 1;
      setPreviewImageAspect(ratio);
    };
    img.src = previewUrl;
  }, [isImagePreview, previewUrl]);

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
    if (!activePreviewFile || !isImagePreview) return;

    const signature = getFileSignature(activePreviewFile);
    const saved = previewSettingsByFile[signature];

    if (saved) {
      setPreviewTransform(saved.transform);
      setPreviewRotation(saved.rotationDeg);
      setPreviewZoom(saved.zoomPct);
    } else {
      setPreviewTransform(
        getDefaultImageTransform(
          previewSheetAspectRatio,
          previewImageAspect,
          previewFitMode,
        ),
      );
      setPreviewRotation(0);
      setPreviewZoom(100);
    }

    setIsPreviewSelected(false);
  }, [
    activePreviewFile,
    isImagePreview,
    previewSheetAspectRatio,
    previewImageAspect,
    previewFitMode,
  ]);

  useEffect(() => {
    if (!activePreviewFile || !isImagePreview) return;

    const signature = getFileSignature(activePreviewFile);
    setPreviewSettingsByFile((prev) => {
      const nextSettings: FilePreviewSettings = {
        transform: { ...previewTransform },
        rotationDeg: previewRotation,
        zoomPct: previewZoom,
      };
      const current = prev[signature];
      if (
        current &&
        current.rotationDeg === nextSettings.rotationDeg &&
        current.zoomPct === nextSettings.zoomPct &&
        current.transform.centerXPct === nextSettings.transform.centerXPct &&
        current.transform.centerYPct === nextSettings.transform.centerYPct &&
        current.transform.widthPct === nextSettings.transform.widthPct &&
        current.transform.heightPct === nextSettings.transform.heightPct
      ) {
        return prev;
      }

      return {
        ...prev,
        [signature]: nextSettings,
      };
    });
  }, [
    activePreviewFile,
    isImagePreview,
    previewTransform,
    previewRotation,
    previewZoom,
  ]);

  useEffect(() => {
    if (!isImagePreview) {
      setIsPreviewSelected(false);
      setActivePreviewHandle(null);
      previewDragRef.current = null;
    }
  }, [isImagePreview]);

  useEffect(() => {
    if (!activePreviewHandle) return;

    const onPointerMove = (event: PointerEvent) => {
      const dragState = previewDragRef.current;
      const sheet = previewSheetRef.current;
      if (!dragState || !sheet) return;

      const rect = sheet.getBoundingClientRect();
      const dxPct = ((event.clientX - dragState.startX) / rect.width) * 100;
      const dyPct = ((event.clientY - dragState.startY) / rect.height) * 100;

      if (dragState.handle === "rotate") {
        const centerX =
          rect.left + (dragState.startTransform.centerXPct / 100) * rect.width;
        const centerY =
          rect.top + (dragState.startTransform.centerYPct / 100) * rect.height;
        const pointerAngle =
          (Math.atan2(event.clientY - centerY, event.clientX - centerX) *
            180) /
          Math.PI;
        const delta = pointerAngle - dragState.startPointerAngle;
        setPreviewRotation(
          ((((dragState.startRotation + delta) % 360) + 360) % 360),
        );
        return;
      }

      if (dragState.handle === "move") {
        const { halfX, halfY } = getRotatedHalfExtents(
          dragState.startTransform.widthPct,
          dragState.startTransform.heightPct,
          dragState.startRotation,
        );
        const nextCenterX = clampNumber(
          dragState.startTransform.centerXPct + dxPct,
          halfX,
          100 - halfX,
        );
        const nextCenterY = clampNumber(
          dragState.startTransform.centerYPct + dyPct,
          halfY,
          100 - halfY,
        );

        setPreviewTransform((prev) => ({
          ...prev,
          centerXPct: nextCenterX,
          centerYPct: nextCenterY,
        }));
        return;
      }

      const handle = dragState.handle;
      const theta = (dragState.startRotation * Math.PI) / 180;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);

      // Project pointer movement onto rotated local axes.
      const localDx = dxPct * cos + dyPct * sin;
      const localDy = -dxPct * sin + dyPct * cos;

      let minX = -dragState.startTransform.widthPct / 2;
      let maxX = dragState.startTransform.widthPct / 2;
      let minY = -dragState.startTransform.heightPct / 2;
      let maxY = dragState.startTransform.heightPct / 2;

      if (handle === "e" || handle === "ne" || handle === "se") {
        maxX += localDx;
      }
      if (handle === "w" || handle === "nw" || handle === "sw") {
        minX += localDx;
      }
      if (handle === "s" || handle === "se" || handle === "sw") {
        maxY += localDy;
      }
      if (handle === "n" || handle === "ne" || handle === "nw") {
        minY += localDy;
      }

      const minSize = 10;

      if (maxX - minX < minSize) {
        if (handle === "w" || handle === "nw" || handle === "sw") {
          minX = maxX - minSize;
        } else {
          maxX = minX + minSize;
        }
      }

      if (maxY - minY < minSize) {
        if (handle === "n" || handle === "ne" || handle === "nw") {
          minY = maxY - minSize;
        } else {
          maxY = minY + minSize;
        }
      }

      let nextWidth = clampNumber(maxX - minX, minSize, 100);
      let nextHeight = clampNumber(maxY - minY, minSize, 100);

      const localCenterShiftX = (minX + maxX) / 2;
      const localCenterShiftY = (minY + maxY) / 2;

      const centerShiftX = localCenterShiftX * cos - localCenterShiftY * sin;
      const centerShiftY = localCenterShiftX * sin + localCenterShiftY * cos;

      let nextCenterX = dragState.startTransform.centerXPct + centerShiftX;
      let nextCenterY = dragState.startTransform.centerYPct + centerShiftY;

      const projected = getRotatedHalfExtents(
        nextWidth,
        nextHeight,
        dragState.startRotation,
      );

      nextCenterX = clampNumber(nextCenterX, projected.halfX, 100 - projected.halfX);
      nextCenterY = clampNumber(nextCenterY, projected.halfY, 100 - projected.halfY);

      setPreviewTransform({
        centerXPct: nextCenterX,
        centerYPct: nextCenterY,
        widthPct: nextWidth,
        heightPct: nextHeight,
      });
    };

    const onPointerUp = () => {
      setActivePreviewHandle(null);
      previewDragRef.current = null;
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [activePreviewHandle]);

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
    setPreviewFitMode("fit");
    setPreviewZoom(100);
    setPreviewRotation(0);
    setPreviewTransform({
      centerXPct: 50,
      centerYPct: 50,
      widthPct: 84,
      heightPct: 84,
    });
    setPreviewSettingsByFile({});
    setImagePageByFile({});
    setSelectedPreviewPage(null);
    setDraggingImageSignature("");
    setExtraImagePages(0);
    setIsPreviewSelected(false);
    setActivePreviewHandle(null);
    setUploadProgress(0);
    setUploadProgressLabel("");
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
    () => pricing?.bindings?.filter((item) => item.enabled && item.id !== "none") ?? [],
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
    let totalSheets = 0;
    const imageSheetCopiesByPage = new Map<number, number>();

    files.forEach((file, index) => {
      if (isImageFile(file)) {
        const signature = getFileSignature(file);
        const fallbackPage = Math.floor(index / 2) + 1;
        const pageNumber = Math.max(1, Number(imagePageByFile[signature] ?? fallbackPage) || 1);
        const currentCopies = imageSheetCopiesByPage.get(pageNumber) ?? 0;
        const nextCopies = normalizeCopiesValue(imageCopiesByPage[pageNumber] ?? copies, copies);
        imageSheetCopiesByPage.set(pageNumber, Math.max(currentCopies, nextCopies));
        return;
      }

      const signature = getFileSignature(file);
      const docCopies = normalizeCopiesValue(documentCopiesByFile[signature] ?? copies, copies);
      totalSheets += docCopies;
    });

    for (const value of imageSheetCopiesByPage.values()) {
      totalSheets += value;
    }

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
  }, [color, copies, documentCopiesByFile, doubleSided, files, imageCopiesByPage, imagePageByFile, selectedBinding, selectedPaper]);

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
        if (fileError === DOC_UNSUPPORTED_MESSAGE) {
          window.alert(fileError);
        }
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
        if (fileError === DOC_UNSUPPORTED_MESSAGE) {
          window.alert(fileError);
        }
        return;
      }
    }

    setFiles((prev) => {
      const { uniqueFiles, duplicateCount } = dedupeFiles(prev, extraFiles);
      const merged = [...prev, ...uniqueFiles];
      if (duplicateCount > 0) {
        showDuplicateFileWarning();
      } else {
        setStatus("");
      }
      return merged;
    });
  };

  const proceedToPayment = async () => {
    if (!files.length) {
      setError("Please select at least one document before continuing.");
      return;
    }

    if (!shopId) {
      setError("Please select a print shop before continuing.");
      return;
    }

    const selectedShop = shops.find((shop) => shop.id === shopId);
    if (!selectedShop) {
      setError("Selected shop was not found. Please reselect a shop.");
      return;
    }

    const selectedShopIsOnline = shopOnlineMap[shopId] ?? selectedShop.isActive;
    if (!selectedShopIsOnline) {
      setError("Selected shop is currently offline. Please choose an online shop.");
      return;
    }

    setStatus("Checking selected printer configuration...");
    try {
      let shopPrinters: Array<{
        status?: unknown;
        supportsColor?: boolean;
      }> = [];

      try {
        const realtimePrinters = await getRealtimeShopPrinters(shopId);
        shopPrinters = Array.isArray(realtimePrinters) ? realtimePrinters : [];
        const realtimeOnlinePrinters = shopPrinters.filter((printer) =>
          isPrinterOperational(printer.status),
        );

        let hasMatchingOnlinePrinter = color
          ? realtimeOnlinePrinters.some(
              (printer) =>
                (printer as { supportsColor?: boolean }).supportsColor !== false,
            )
          : realtimeOnlinePrinters.length > 0;

        // Guard against transient stale realtime snapshots by validating once via REST.
        if (!hasMatchingOnlinePrinter) {
          const apiPrinters = await getShopPrinters(shopId);
          const apiOnlinePrinters = (apiPrinters as Array<{
            status?: unknown;
            supportsColor?: boolean;
          }>).filter((printer) => isPrinterOperational(printer.status));

          hasMatchingOnlinePrinter = color
            ? apiOnlinePrinters.some(
                (printer) =>
                  (printer as { supportsColor?: boolean }).supportsColor !== false,
              )
            : apiOnlinePrinters.length > 0;
        }

        if (!hasMatchingOnlinePrinter) {
          setStatus("");
          setError(
            color
              ? "No online color printer is available on desktop for this shop."
              : "No online printer is available on desktop for this shop.",
          );
          return;
        }
      } catch {
        const apiPrinters = await getShopPrinters(shopId);
        const apiOnlinePrinters = (apiPrinters as Array<{
          status?: unknown;
          supportsColor?: boolean;
        }>).filter((printer) => isPrinterOperational(printer.status));

        const hasMatchingOnlinePrinter = color
          ? apiOnlinePrinters.some(
              (printer) =>
                (printer as { supportsColor?: boolean }).supportsColor !== false,
            )
          : apiOnlinePrinters.length > 0;

      if (!hasMatchingOnlinePrinter) {
        setStatus("");
        setError(
          color
            ? "No online color printer is available on desktop for this shop."
            : "No online printer is available on desktop for this shop.",
        );
        return;
      }
      }
    } catch {
      setStatus("");
      setError("Unable to verify desktop printer status right now. Please try again.");
      return;
    }

    setError("");
    setStatus("");
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

    const bindingRequiresManual = binding !== "none";
    const manualWork =
      bindingRequiresManual || !hasOnlinePrinter || !hasEligiblePrinterForSelection;

    if (manualWork) {
      setStatus(
        bindingRequiresManual
          ? "Binding jobs are handled as manual work by the shop."
          : hasOnlinePrinter
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
    setUploadProgress(0);
    setUploadProgressLabel("Starting upload...");
    let currentOrderId = "";
    let createdJobId = "";
    let createdJobNumber = "";
    let uploadedFiles: Array<{
      id: string;
      fileName: string;
      signature: string;
      pageCount: number;
      previewTransform?: PreviewPrintTransform;
      assignedPage?: number;
    }> | null = null;
    let resolvedPages = filePages;

    const createPendingPaymentJob = async () => {
      setPaymentPhase("creating_job");
      setStatus("Uploading documents and creating print job...");

      if (!uploadedFiles) {
        uploadedFiles = [];
        const imageFilesWithOrder = files
          .map((file, index) => ({ file, index }))
          .filter((entry) => isImageFile(entry.file));
        const imageOrderBySignature = new Map<string, number>();
        const bucketPageBySignature = new Map<string, number>();
        imageFilesWithOrder.forEach((entry, order) => {
          imageOrderBySignature.set(getFileSignature(entry.file), order);
        });
        imagePageBuckets.forEach((bucket) => {
          bucket.signatures.forEach((signature) => {
            bucketPageBySignature.set(signature, bucket.pageNumber);
          });
        });

        for (let index = 0; index < files.length; index += 1) {
          const currentFile = files[index];
          setUploadProgressLabel(
            `Uploading ${currentFile.name} (${index + 1}/${files.length})`,
          );

          const uploaded = await uploadDocument(currentFile, {
            onProgress: (progress) => {
              const bounded = Math.max(0, Math.min(100, Number(progress) || 0));
              const aggregate = ((index + bounded / 100) / files.length) * 100;
              setUploadProgress((prev) =>
                aggregate > prev ? aggregate : prev,
              );
            },
          });
          const pageCount =
            Number(uploaded.pageCount) > 0 ? Number(uploaded.pageCount) : 1;

          const signature = getFileSignature(currentFile);
          const previewSettings = previewSettingsByFile[signature];
          const assignedPage = Math.max(
            1,
            bucketPageBySignature.get(signature) ?? imagePageByFile[signature] ?? 1,
          );
          const imageOrder = imageOrderBySignature.get(signature) ?? 0;
          const imageAspect = previewImageAspectByFile[signature] ?? 1;
          const fallbackTransform = getCompositeDefaultImageTransform(
            previewSheetAspectRatio,
            imageAspect,
            imageOrder,
            imageFilesWithOrder.length,
          );
          const previewTransformForPrint =
            isImageFile(currentFile)
              ? {
                  centerXPct:
                    previewSettings?.transform.centerXPct ??
                    fallbackTransform.centerXPct,
                  centerYPct:
                    previewSettings?.transform.centerYPct ??
                    fallbackTransform.centerYPct,
                  widthPct:
                    previewSettings?.transform.widthPct ??
                    fallbackTransform.widthPct,
                  heightPct:
                    previewSettings?.transform.heightPct ??
                    fallbackTransform.heightPct,
                  rotationDeg: previewSettings?.rotationDeg ?? 0,
                  zoomPct: previewSettings?.zoomPct ?? 100,
                }
              : undefined;

          uploadedFiles.push({
            id: uploaded.id,
            fileName: currentFile.name,
            signature,
            pageCount,
            previewTransform: previewTransformForPrint,
            assignedPage: isImageFile(currentFile) ? assignedPage : undefined,
          });

          const completedProgress = ((index + 1) / files.length) * 100;
          setUploadProgress(completedProgress);
          setUploadProgressLabel(`Uploaded ${index + 1}/${files.length}`);
        }

        const groupedAssignedPages = new Set<number>();
        resolvedPages = uploadedFiles.reduce((sum, item) => {
          const assignedPage = Number(item.assignedPage);
          if (Number.isFinite(assignedPage)) {
            groupedAssignedPages.add(Math.max(1, Math.floor(assignedPage)));
            return sum;
          }

          return sum + item.pageCount;
        }, 0);
        resolvedPages += groupedAssignedPages.size;
        resolvedPages = Math.max(1, resolvedPages);
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
          documentQueue: uploadedFiles.map((item) => {
            const isImage = Boolean(item.assignedPage)
            const effectiveCopies = isImage
              ? normalizeCopiesValue(
                  imageCopiesByPage[Math.max(1, Math.floor(Number(item.assignedPage) || 1))] ?? copies,
                  copies,
                )
              : normalizeCopiesValue(documentCopiesByFile[item.signature] ?? copies, copies)

            return {
              fileId: item.id,
              fileName: item.fileName,
              pageCount: item.pageCount,
              copies: effectiveCopies,
              previewTransform: item.previewTransform,
              assignedPage: item.assignedPage,
            }
          }),
        },
      });

      setUploadProgress(100);
      setUploadProgressLabel("Preparing checkout...");

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
        name: env.razorpayMerchantName || "PrintPe",
        description: `Print order ${createdJobNumber || order.jobNumber || "PrintPe"}`,
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
      const canReconcile = Boolean(currentOrderId);

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
      setUploadProgressLabel("");
      setUploadProgress(0);
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
              <p>Choose your file (PDF, JPG, PNG)</p>
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
                    <p className="file-hints">PDF, JPG, PNG • Max 50MB</p>
                  </div>
                )}

                <input
                  type="file"
                  className="file-input-upload"
                  style={{ display: "none" }}
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  onChange={(e) => {
                    const selected = Array.from(e.target.files ?? []);
                    void onPickFiles(selected);
                    e.currentTarget.value = "";
                  }}
                />

                <input
                  type="file"
                  className="file-input-add-more"
                  style={{ display: "none" }}
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  onChange={(e) => {
                    const selected = Array.from(e.target.files ?? []);
                    void onAppendFiles(selected);
                    e.currentTarget.value = "";
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
                      DOC/DOCX files are not supported right now because they
                      may cause formatting issues. Convert to PDF before upload.
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
                  <div className="upload-documents-copy-list">
                    {files.filter((item) => !isImageFile(item)).length > 0 ? (
                      files
                        .filter((item) => !isImageFile(item))
                        .map((item, index) => {
                          const signature = getFileSignature(item)
                          const itemCopies = normalizeCopiesValue(documentCopiesByFile[signature] ?? copies, copies)

                          return (
                            <div key={`${item.name}-${item.size}-${index}`} className="upload-document-copy-row">
                              <div className="upload-document-copy-label">
                                <span>{index + 1}. {item.name}</span>
                              </div>
                              <div className="copy-input-spinner">
                                <button
                                  type="button"
                                  className="spinner-btn spinner-down"
                                  onClick={() =>
                                    setDocumentCopiesByFile((prev) => ({
                                      ...prev,
                                      [signature]: Math.max(1, itemCopies - 1),
                                    }))
                                  }
                                  title="Decrease"
                                  aria-label={`Decrease copies for ${item.name}`}
                                >
                                  −
                                </button>
                                <input
                                  type="number"
                                  min={1}
                                  inputMode="numeric"
                                  value={itemCopies}
                                  onChange={(event) =>
                                    setDocumentCopiesByFile((prev) => ({
                                      ...prev,
                                      [signature]: normalizeCopiesValue(event.target.value, itemCopies),
                                    }))
                                  }
                                  className="upload-document-copy-input"
                                  aria-label={`Copies for ${item.name}`}
                                />
                                <button
                                  type="button"
                                  className="spinner-btn spinner-up"
                                  onClick={() =>
                                    setDocumentCopiesByFile((prev) => ({
                                      ...prev,
                                      [signature]: itemCopies + 1,
                                    }))
                                  }
                                  title="Increase"
                                  aria-label={`Increase copies for ${item.name}`}
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          )
                        })
                    ) : null}
                  </div>
                  {files.some((item) => isImageFile(item)) ? (
                    <p className="upload-files-summary-note">
                      Image page copies are set in the Page Assignment panel below.
                    </p>
                  ) : null}
                </article>
              ) : null}

              {/* Print Options */}
              <div className="print-options-section animate-rise delay-2">
                <h3 className="section-title">Print Settings</h3>

                {/* Copies and Paper Size Row */}
                <div className="options-row">
                  <div className="option-card">
                    <label className="option-label">📄 Copies</label>
                    <div className="number-input-group number-input-group-prominent">
                      <button
                        type="button"
                        onClick={() => setCopies(Math.max(1, copies - 1))}
                        className="number-btn"
                        aria-label="Decrease total copies"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min={1}
                        inputMode="numeric"
                        value={copies}
                        onChange={(e) =>
                          setCopies(Math.max(1, Number(e.target.value) || 1))
                        }
                        className="number-display"
                        aria-label="Total copies"
                      />
                      <button
                        type="button"
                        onClick={() => setCopies(copies + 1)}
                        className="number-btn"
                        aria-label="Increase total copies"
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

                <article className="print-preview-card" aria-live="polite">
                  <div className="print-preview-header">
                    <h4>Print Preview</h4>
                    <p>
                      Client-side simulation before payment. This helps you
                      adjust how image/file appears on paper.
                    </p>
                  </div>

                  {files.length > 1 ? (
                    <div className="print-preview-file-tabs" role="tablist" aria-label="Preview file selector">
                      {files.map((item, index) => (
                        <button
                          key={`${item.name}-${item.size}-${index}-preview`}
                          type="button"
                          role="tab"
                          aria-selected={index === previewIndex}
                          className={`print-preview-file-tab ${index === previewIndex ? "active" : ""}`}
                          onClick={() => setPreviewIndex(index)}
                        >
                          {index + 1}. {item.name}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {imagePreviewFiles.length > 1 ? (
                    <div className="print-page-grouping-card">
                      <div className="print-page-grouping-head">
                        <strong>Page Assignment</strong>
                        <button
                          type="button"
                          className="print-page-grouping-add"
                          onClick={addImagePageBucket}
                        >
                          + Add Page
                        </button>
                      </div>
                      <p>
                        Drag image chips into page boxes. Images inside one box
                        will print on the same page.
                      </p>
                      <div className="print-page-grouping-grid">
                        {imagePageBuckets.map((bucket) => (
                          <div
                            key={`page-bucket-${bucket.pageNumber}`}
                            className={`print-page-group ${selectedPageBucket?.pageNumber === bucket.pageNumber ? "active" : ""}`}
                            onClick={() => {
                              setSelectedPreviewPage(bucket.pageNumber);
                              const firstSignature = bucket.signatures[0];
                              if (!firstSignature) return;
                              const entry = imagePreviewFiles.find(
                                ({ file }) =>
                                  getFileSignature(file) === firstSignature,
                              );
                              if (entry) {
                                setPreviewIndex(entry.fileIndex);
                              }
                            }}
                            onDragOver={(event) => {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              const droppedSignature =
                                event.dataTransfer.getData("text/plain") ||
                                draggingImageSignature;
                              if (!droppedSignature) return;
                              assignImageToPage(droppedSignature, bucket.pageNumber);
                              setSelectedPreviewPage(bucket.pageNumber);
                              setDraggingImageSignature("");
                            }}
                          >
                            <div className="print-page-group-head">
                              <h5>Page {bucket.pageNumber}</h5>
                              <button
                                type="button"
                                className="print-page-group-remove"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  removeImagePageBucket(bucket.pageNumber);
                                }}
                                disabled={imagePageBuckets.length <= 1}
                                aria-label={`Remove Page ${bucket.pageNumber}`}
                              >
                                Remove
                              </button>
                            </div>
                            {bucket.signatures.length > 0 ? (
                              <div className="print-page-group-chips">
                                {bucket.signatures.map((signature) => {
                                  const entry = imagePreviewFiles.find(
                                    ({ file }) =>
                                      getFileSignature(file) === signature,
                                  );
                                  if (!entry) return null;
                                  return (
                                    <button
                                      key={`${signature}-chip`}
                                      type="button"
                                      draggable
                                      className="print-page-group-chip"
                                      onClick={() => {
                                        setSelectedPreviewPage(bucket.pageNumber);
                                        setPreviewIndex(entry.fileIndex);
                                      }}
                                      onDragStart={(event) => {
                                        event.dataTransfer.setData("text/plain", signature);
                                        event.dataTransfer.effectAllowed = "move";
                                        setDraggingImageSignature(signature);
                                      }}
                                      onDragEnd={() => setDraggingImageSignature("")}
                                    >
                                      {entry.file.name}
                                    </button>
                                  );
                                })}
                              </div>
                            ) : (
                              <span className="print-page-group-empty">
                                Drop images here
                              </span>
                            )}

                            <div className="print-page-group-footer">
                              <span className="print-page-group-copy-label">Copies</span>
                              <div className="copy-input-spinner">
                                <button
                                  type="button"
                                  className="spinner-btn spinner-down"
                                  onClick={() =>
                                    setImageCopiesByPage((prev) => ({
                                      ...prev,
                                      [bucket.pageNumber]: Math.max(1, (prev[bucket.pageNumber] ?? copies) - 1),
                                    }))
                                  }
                                  title="Decrease"
                                  aria-label={`Decrease copies for page ${bucket.pageNumber}`}
                                >
                                  −
                                </button>
                                <input
                                  type="number"
                                  min={1}
                                  inputMode="numeric"
                                  value={normalizeCopiesValue(imageCopiesByPage[bucket.pageNumber] ?? copies, copies)}
                                  onChange={(event) =>
                                    setImageCopiesByPage((prev) => ({
                                      ...prev,
                                      [bucket.pageNumber]: normalizeCopiesValue(event.target.value, copies),
                                    }))
                                  }
                                  className="print-page-group-copy-input"
                                  aria-label={`Copies for page ${bucket.pageNumber}`}
                                />
                                <button
                                  type="button"
                                  className="spinner-btn spinner-up"
                                  onClick={() =>
                                    setImageCopiesByPage((prev) => ({
                                      ...prev,
                                      [bucket.pageNumber]: normalizeCopiesValue(prev[bucket.pageNumber] ?? copies, copies) + 1,
                                    }))
                                  }
                                  title="Increase"
                                  aria-label={`Increase copies for page ${bucket.pageNumber}`}
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="print-preview-controls">
                    <label>
                      Fit
                      <select
                        value={previewFitMode}
                        onChange={(e) =>
                          setPreviewFitMode(
                            e.target.value as "fit" | "fill" | "actual",
                          )
                        }
                      >
                        <option value="fit">Fit to page</option>
                        <option value="fill">Fill page</option>
                        <option value="actual">Actual size</option>
                      </select>
                    </label>

                    <label>
                      Zoom {previewZoom}%
                      <input
                        type="range"
                        min={60}
                        max={160}
                        step={5}
                        value={previewZoom}
                        onChange={(e) =>
                          setPreviewZoom(Number(e.target.value) || 100)
                        }
                      />
                    </label>

                    <div className="print-preview-rotate-group">
                      <span>Rotate</span>
                      <div>
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewRotation(
                              (current) =>
                                ((((current - 90) % 360) + 360) % 360),
                            )
                          }
                        >
                          -90°
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewRotation(
                              (current) => (current + 90) % 360,
                            )
                          }
                        >
                          +90°
                        </button>
                      </div>
                    </div>

                  </div>

                  <div className="print-preview-stage-wrap">
                    <div
                      ref={previewSheetRef}
                      className="print-preview-sheet"
                      onPointerDown={(event) => {
                        if (event.target === event.currentTarget) {
                          setIsPreviewSelected(false);
                        }
                      }}
                      style={
                        {
                          "--paper-ratio": String(previewSheetAspectRatio),
                        } as React.CSSProperties
                      }
                    >
                      {isImagePreview && filteredImagePreviewLayerList.length > 0 ? (
                        filteredImagePreviewLayerList.map((layer) => {
                          const layerWidth = clampNumber(
                            layer.settings.transform.widthPct,
                            8,
                            100,
                          );
                          const layerHeight = clampNumber(
                            layer.settings.transform.heightPct,
                            8,
                            100,
                          );

                          return (
                            <div
                              key={`${layer.signature}-layer`}
                              className={`print-preview-media-frame ${layer.isActive && isPreviewSelected ? "selected" : ""}`}
                              style={{
                                left: `${layer.settings.transform.centerXPct}%`,
                                top: `${layer.settings.transform.centerYPct}%`,
                                width: `${layerWidth}%`,
                                height: `${layerHeight}%`,
                                transform: `translate(-50%, -50%) rotate(${layer.settings.rotationDeg}deg)`,
                                zIndex: layer.isActive ? 4 : 2,
                              }}
                              onPointerDown={(event) => {
                                if (!layer.isActive) {
                                  setPreviewIndex(layer.fileIndex);
                                  setIsPreviewSelected(true);
                                  event.preventDefault();
                                  event.stopPropagation();
                                  return;
                                }

                                onPreviewFramePointerDown(event);
                              }}
                            >
                              <img
                                src={layer.url}
                                alt={layer.file.name || "Print preview"}
                                className="print-preview-image-content"
                                style={{
                                  objectFit: "fill",
                                  transform: `scale(${layer.settings.zoomPct / 100})`,
                                  transformOrigin: "center",
                                }}
                              />

                              {layer.isActive && isPreviewSelected ? (
                                <>
                                  <button type="button" className="preview-handle preview-handle-nw" style={{ cursor: getRotatedResizeCursor("nw", previewRotation) }} onPointerDown={(e) => beginPreviewInteraction("nw", e)} aria-label="Resize from top-left" />
                                  <button type="button" className="preview-handle preview-handle-ne" style={{ cursor: getRotatedResizeCursor("ne", previewRotation) }} onPointerDown={(e) => beginPreviewInteraction("ne", e)} aria-label="Resize from top-right" />
                                  <button type="button" className="preview-handle preview-handle-sw" style={{ cursor: getRotatedResizeCursor("sw", previewRotation) }} onPointerDown={(e) => beginPreviewInteraction("sw", e)} aria-label="Resize from bottom-left" />
                                  <button type="button" className="preview-handle preview-handle-se" style={{ cursor: getRotatedResizeCursor("se", previewRotation) }} onPointerDown={(e) => beginPreviewInteraction("se", e)} aria-label="Resize from bottom-right" />
                                  <button type="button" className="preview-handle preview-handle-n" style={{ cursor: getRotatedResizeCursor("n", previewRotation) }} onPointerDown={(e) => beginPreviewInteraction("n", e)} aria-label="Resize from top" />
                                  <button type="button" className="preview-handle preview-handle-s" style={{ cursor: getRotatedResizeCursor("s", previewRotation) }} onPointerDown={(e) => beginPreviewInteraction("s", e)} aria-label="Resize from bottom" />
                                  <button type="button" className="preview-handle preview-handle-e" style={{ cursor: getRotatedResizeCursor("e", previewRotation) }} onPointerDown={(e) => beginPreviewInteraction("e", e)} aria-label="Resize from right" />
                                  <button type="button" className="preview-handle preview-handle-w" style={{ cursor: getRotatedResizeCursor("w", previewRotation) }} onPointerDown={(e) => beginPreviewInteraction("w", e)} aria-label="Resize from left" />
                                  <button type="button" className="preview-rotate-handle" onPointerDown={(e) => beginPreviewInteraction("rotate", e)} aria-label="Rotate image" />
                                </>
                              ) : null}
                            </div>
                          );
                        })
                      ) : isPdfPreview && previewUrl ? (
                        <iframe
                          title="PDF preview"
                          src={previewUrl}
                          className="print-preview-pdf"
                        />
                      ) : activePreviewFile ? (
                        <div className="print-preview-fallback">
                          <strong>Preview unavailable for this file type</strong>
                          <span>
                            You can still continue. Final print will use your
                            selected paper and settings.
                          </span>
                        </div>
                      ) : (
                        <div className="print-preview-fallback">
                          <strong>No file selected</strong>
                          <span>Please upload a file to preview.</span>
                        </div>
                      )}
                    </div>
                  </div>
                </article>
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

              {isSubmitting ? (
                <div className="upload-progress-card" aria-live="polite">
                  <div className="upload-progress-header">
                    <span className="upload-progress-title">Uploading files</span>
                    <span className="upload-progress-percent">
                      {Math.round(uploadProgress)}%
                    </span>
                  </div>
                  <div className="upload-progress-track">
                    <div
                      className="upload-progress-fill"
                      style={{ width: `${Math.max(0, Math.min(100, uploadProgress))}%` }}
                    />
                  </div>
                  <p className="upload-progress-status">
                    {uploadProgressLabel || status || "Please wait..."}
                  </p>
                </div>
              ) : null}

              <button
                className="btn-primary btn-razorpay"
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
