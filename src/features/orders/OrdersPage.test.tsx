import { render, screen } from "@testing-library/react";
import { OrdersPage } from "./OrdersPage";

const mocked = vi.hoisted(() => ({
  getMyOrders: vi.fn(),
  getOrderQueuePosition: vi.fn(),
  getTokenBundle: vi.fn(),
  connectOrderTrackingSocket: vi.fn(),
}));

vi.mock("../../services/api/ordersApi", () => ({
  getMyOrders: mocked.getMyOrders,
  getOrderQueuePosition: mocked.getOrderQueuePosition,
}));

vi.mock("../../services/storage/tokenStorage", () => ({
  getTokenBundle: mocked.getTokenBundle,
}));

vi.mock("../../services/realtime/orderTrackingSocket", () => ({
  connectOrderTrackingSocket: mocked.connectOrderTrackingSocket,
}));

describe("OrdersPage", () => {
  it("renders loaded orders with queue details", async () => {
    mocked.getMyOrders.mockResolvedValue([
      {
        id: "o1",
        jobNumber: "JOB-1",
        status: "queued",
        totalPages: 12,
        totalPrice: 24,
        createdAt: "2026-04-01T08:00:00.000Z",
      },
    ]);
    mocked.getOrderQueuePosition.mockResolvedValue({
      position: 2,
      estimatedMinutes: 8,
    });
    mocked.getTokenBundle.mockResolvedValue({
      accessToken: "token",
      refreshToken: "refresh",
    });
    mocked.connectOrderTrackingSocket.mockReturnValue({
      on: vi.fn(),
      disconnect: vi.fn(),
    });

    render(<OrdersPage />);

    expect(await screen.findByText("JOB-1")).toBeInTheDocument();
    expect(screen.getByText("1 active")).toBeInTheDocument();
    expect(screen.getByText("Queue: #2")).toBeInTheDocument();
    expect(screen.getByText("ETA: 8 min")).toBeInTheDocument();
  });
});
