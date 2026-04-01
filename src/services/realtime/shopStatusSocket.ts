import { io, Socket } from "socket.io-client";
import { env } from "../api/env";

export type ShopStatusChangedPayload = {
  shopId: string;
  isOnline: boolean;
};

export type ShopStatusSnapshotPayload = {
  shops: Array<{
    shopId: string;
    isOnline: boolean;
  }>;
};

export function connectShopStatusSocket(token: string): Socket {
  return io(`${env.wsBaseUrl}/shop-status`, {
    transports: ["websocket"],
    auth: { token },
    autoConnect: true,
    reconnection: true,
  });
}
