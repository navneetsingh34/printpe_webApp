import { io, Socket } from 'socket.io-client';
import { env } from '../api/env';

export type OrderUpdatedPayload = {
  id?: string;
  jobId?: string;
  status?: string;
  queuePosition?: number | null;
  estimatedReadyTime?: string | null;
};

export function connectOrderTrackingSocket(token: string): Socket {
  return io(`${env.wsBaseUrl}/student`, {
    transports: ['websocket'],
    auth: { token },
    autoConnect: true,
    reconnection: true,
  });
}
