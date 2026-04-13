export type OrderItem = {
  id: string;
  jobNumber: string;
  status: string;
  totalPages: number;
  totalPrice: number;
  shopId: string;
  queuePosition?: number | null;
  estimatedReadyTime?: string | null;
  etaMinutes?: number | null;
  etaReadyTime?: string | null;
  createdAt: string;
};

export type QueuePositionInfo = {
  position: number | null;
  estimatedMinutes: number | null;
  estimatedReadyTime?: string | null;
};
