export type OrderItem = {
  id: string;
  jobNumber: string;
  status: string;
  totalPages: number;
  totalPrice: number;
  queuePosition?: number | null;
  estimatedReadyTime?: string | null;
  createdAt: string;
};

export type QueuePositionInfo = {
  position: number | null;
  estimatedMinutes: number | null;
};
