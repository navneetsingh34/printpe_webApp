import { apiRequest } from './httpClient';
import { OrderItem, QueuePositionInfo } from '../../shared/types/order';

export function getMyOrders(): Promise<OrderItem[]> {
  return apiRequest('/print-jobs/my-orders', { method: 'GET' }, { auth: true });
}

export function getOrderQueuePosition(orderId: string): Promise<QueuePositionInfo> {
  return apiRequest(`/print-jobs/${encodeURIComponent(orderId)}/queue-position`, { method: 'GET' }, { auth: true });
}

export function collectOrder(orderId: string): Promise<OrderItem> {
  return apiRequest(
    `/print-jobs/${encodeURIComponent(orderId)}/collect`,
    { method: 'POST' },
    { auth: true },
  );
}

export type OrderDocumentItem = {
  fileId: string;
  name: string;
  pageCount: number;
  copies: number;
  url: string;
};

export function getOrderDocumentUrls(
  orderId: string,
): Promise<{ documents: OrderDocumentItem[] }> {
  return apiRequest(
    `/print-jobs/${encodeURIComponent(orderId)}/document-urls`,
    { method: 'GET' },
    { auth: true },
  );
}
