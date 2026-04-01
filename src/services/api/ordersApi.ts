import { apiRequest } from './httpClient';
import { OrderItem, QueuePositionInfo } from '../../shared/types/order';

export function getMyOrders(): Promise<OrderItem[]> {
  return apiRequest('/print-jobs/my-orders', { method: 'GET' }, { auth: true });
}

export function getOrderQueuePosition(orderId: string): Promise<QueuePositionInfo> {
  return apiRequest(`/print-jobs/${encodeURIComponent(orderId)}/queue-position`, { method: 'GET' }, { auth: true });
}
