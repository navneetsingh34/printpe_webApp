import { apiRequest } from './httpClient';

export type NotificationItem = {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  printJobId?: string | null;
  createdAt: string;
};

export type NotificationsPage = { data: NotificationItem[]; total: number };
export type UnreadCountPayload = { unreadCount: number };

export function getNotifications(page = 1, limit = 30): Promise<NotificationsPage> {
  return apiRequest(`/notifications?page=${encodeURIComponent(String(page))}&limit=${encodeURIComponent(String(limit))}`, { method: 'GET' }, { auth: true });
}
export function getUnreadCount(): Promise<UnreadCountPayload> {
  return apiRequest('/notifications/unread-count', { method: 'GET' }, { auth: true });
}
export function markNotificationRead(notificationId: string): Promise<{ success: boolean }> {
  return apiRequest(`/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'PATCH' }, { auth: true });
}
export function markAllNotificationsRead(): Promise<{ success: boolean }> {
  return apiRequest('/notifications/read-all', { method: 'PATCH' }, { auth: true });
}
