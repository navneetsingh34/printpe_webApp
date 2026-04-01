import { io, Socket } from 'socket.io-client';
import { env } from '../api/env';

type NotificationsSocketHandlers = {
  onNotification?: (payload: unknown) => void;
  onUnreadCount?: (payload: { count: number }) => void;
  onQueuePositionUpdate?: (payload: unknown) => void;
};

export function connectNotificationsSocket(token: string, handlers: NotificationsSocketHandlers): Socket {
  const socket = io(`${env.wsBaseUrl}/notifications`, {
    transports: ['websocket'],
    auth: { token },
    autoConnect: true,
    reconnection: true,
  });
  if (handlers.onNotification) socket.on('notification:new', handlers.onNotification);
  if (handlers.onUnreadCount) socket.on('notification:unread-count', handlers.onUnreadCount);
  if (handlers.onQueuePositionUpdate) socket.on('queue:position-update', handlers.onQueuePositionUpdate);
  return socket;
}
