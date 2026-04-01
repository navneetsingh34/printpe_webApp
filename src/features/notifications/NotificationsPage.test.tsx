import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotificationsPage } from "./NotificationsPage";

const mocked = vi.hoisted(() => ({
  getNotifications: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  markNotificationRead: vi.fn(),
  getTokenBundle: vi.fn(),
  connectNotificationsSocket: vi.fn(),
  refreshUnreadCount: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/api/notificationsApi", () => ({
  getNotifications: mocked.getNotifications,
  markAllNotificationsRead: mocked.markAllNotificationsRead,
  markNotificationRead: mocked.markNotificationRead,
}));

vi.mock("../../services/storage/tokenStorage", () => ({
  getTokenBundle: mocked.getTokenBundle,
}));

vi.mock("../../services/realtime/notificationsSocket", () => ({
  connectNotificationsSocket: mocked.connectNotificationsSocket,
}));

vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({
    refreshUnreadCount: mocked.refreshUnreadCount,
  }),
}));

describe("NotificationsPage", () => {
  it("marks a single notification as read", async () => {
    mocked.getNotifications.mockResolvedValue({
      data: [
        {
          id: "n1",
          userId: "u1",
          title: "Queued",
          message: "Your job is queued",
          type: "ORDER_STATUS",
          isRead: false,
          createdAt: "2026-04-01T08:00:00.000Z",
        },
      ],
      total: 1,
    });
    mocked.markNotificationRead.mockResolvedValue({ success: true });
    mocked.markAllNotificationsRead.mockResolvedValue({ success: true });
    mocked.getTokenBundle.mockResolvedValue(null);
    mocked.connectNotificationsSocket.mockReturnValue({
      on: vi.fn(),
      disconnect: vi.fn(),
    });

    render(<NotificationsPage />);

    expect(await screen.findByText("Queued")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark read" }));

    await waitFor(() => {
      expect(mocked.markNotificationRead).toHaveBeenCalledWith("n1");
      expect(mocked.refreshUnreadCount).toHaveBeenCalled();
    });
  });
});
