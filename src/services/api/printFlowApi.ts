import { env } from "./env";
import { apiRequest, ApiError } from "./httpClient";
import { getTokenBundle } from "../storage/tokenStorage";

export type UploadedFileResult = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  pageCount?: number | null;
};

export type CreatePrintJobInput = {
  shopId: string;
  fileId: string;
  totalPages: number;
  printOptions: {
    copies: number;
    color: boolean;
    doubleSided: boolean;
    paperSize: string;
    binding?: string;
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

export async function uploadDocument(file: File): Promise<UploadedFileResult> {
  const tokens = await getTokenBundle();
  if (!tokens?.accessToken)
    throw new ApiError("Please login again to upload files.", 401);
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(
    `${env.apiBaseUrl.replace(/\/$/, "")}/files/upload`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
      body,
    },
  );
  const payload = (await response.json()) as {
    data: UploadedFileResult;
    message?: string;
  };
  if (!response.ok)
    throw new ApiError(
      payload.message ?? `Upload failed (${response.status})`,
      response.status,
    );
  return payload.data ?? (payload as unknown as UploadedFileResult);
}

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
  printJobId: string,
): Promise<PaymentOrderResult> {
  return apiRequest(
    "/payments/create-order",
    {
      method: "POST",
      body: JSON.stringify({ printJobId }),
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
