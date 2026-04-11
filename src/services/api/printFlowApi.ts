import { apiRequest, ApiError } from "./httpClient";
import { getTokenBundle } from "../storage/tokenStorage";
import type { UploadedFileResult } from "./filesApi";
import { uploadDocument } from "./filesApi";

export type CreatePrintJobInput = {
  shopId: string;
  fileId: string;
  totalPages: number;
  paymentOrderId?: string;
  printOptions: {
    copies: number;
    color: boolean;
    doubleSided: boolean;
    paperSize: string;
    manualWork?: boolean;
    binding?: string;
    documentQueue?: Array<{
      fileId: string;
      fileName: string;
      pageCount: number;
      copies: number;
      assignedPage?: number;
      previewTransform?: {
        centerXPct: number;
        centerYPct: number;
        widthPct: number;
        heightPct: number;
        rotationDeg: number;
        zoomPct: number;
      };
    }>;
  };
};

export type CreatedPrintJob = {
  id: string;
  jobNumber: string;
  totalPages: number;
  totalPrice: number;
  status: string;
};

export type PaymentOrderResult = {
  paymentId: string;
  orderId: string;
  amount: number;
  currency: string;
  jobNumber?: string;
  printCost?: number;
  convenienceFee?: number;
  totalAmount?: number;
};

export type CreatePaymentOrderInput =
  | { printJobId: string }
  | {
      estimatedPrintCost: number;
      shopId: string;
      description?: string;
    };

export type VerifyPaymentInput = {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
};

export type PaymentRecord = {
  id: string;
  status: string;
  razorpayOrderId: string;
  razorpayPaymentId?: string;
};

// Export uploadDocument from filesApi for backward compatibility
export { uploadDocument } from "./filesApi";

export function createPrintJob(
  input: CreatePrintJobInput,
): Promise<CreatedPrintJob> {
  return apiRequest(
    "/print-jobs",
    { method: "POST", body: JSON.stringify(input) },
    { auth: true },
  );
}

export function createPaymentOrder(
  input: CreatePaymentOrderInput,
): Promise<PaymentOrderResult> {
  return apiRequest(
    "/payments/create-order",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    { auth: true },
  );
}

export function verifyPayment(
  input: VerifyPaymentInput,
): Promise<{ message?: string }> {
  return apiRequest(
    "/payments/verify",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    { auth: true },
  );
}

export function reconcilePayment(
  orderId: string,
): Promise<{ status: string; payment?: PaymentRecord }> {
  return apiRequest(
    "/payments/reconcile",
    {
      method: "POST",
      body: JSON.stringify({ orderId }),
    },
    { auth: true },
  );
}

export function getPaymentByOrderId(orderId: string): Promise<PaymentRecord> {
  return apiRequest(
    `/payments/${encodeURIComponent(orderId)}`,
    { method: "GET" },
    { auth: true },
  );
}
