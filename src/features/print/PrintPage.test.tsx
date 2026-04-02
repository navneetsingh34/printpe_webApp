import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PrintPage } from "./PrintPage";

const mocked = vi.hoisted(() => ({
  getAllShops: vi.fn(),
  getShopPricing: vi.fn(),
  uploadDocument: vi.fn(),
  createPrintJob: vi.fn(),
  createPaymentOrder: vi.fn(),
  verifyPayment: vi.fn(),
  reconcilePayment: vi.fn(),
  getPaymentByOrderId: vi.fn(),
}));

vi.mock("../../services/api/shopsApi", () => ({
  getAllShops: mocked.getAllShops,
  getShopPricing: mocked.getShopPricing,
}));

vi.mock("../../services/api/printFlowApi", () => ({
  uploadDocument: mocked.uploadDocument,
  createPrintJob: mocked.createPrintJob,
  createPaymentOrder: mocked.createPaymentOrder,
  verifyPayment: mocked.verifyPayment,
  reconcilePayment: mocked.reconcilePayment,
  getPaymentByOrderId: mocked.getPaymentByOrderId,
}));

vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      email: "student@example.com",
      firstName: "Test",
      lastName: "User",
      phone: "9999999999",
    },
  }),
}));

describe("PrintPage", () => {
  it("blocks unsupported file types before upload API call", async () => {
    mocked.getAllShops.mockResolvedValue([
      {
        id: "shop-1",
        name: "Campus Print",
        address: "Main Road",
        latitude: 0,
        longitude: 0,
        phone: "123",
        email: "a@b.com",
        openingTime: "09:00",
        closingTime: "18:00",
        isActive: true,
      },
    ]);
    mocked.getShopPricing.mockResolvedValue({
      paperPricing: [
        {
          paperSize: "A4",
          enabled: true,
          bw: { firstNPages: 20, firstNRate: 0.5, afterNRate: 0.5 },
          color: { firstNPages: 20, firstNRate: 1, afterNRate: 1 },
          doubleSidedDiscountPercent: 0,
        },
      ],
      bindings: [{ id: "none", label: "None", price: 0, enabled: true }],
    });

    const { container } = render(
      <MemoryRouter>
        <PrintPage />
      </MemoryRouter>,
    );

    const startButton = await screen.findByRole("button", {
      name: "Start Upload",
    });
    fireEvent.click(startButton);

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const badFile = new File(["x"], "notes.txt", { type: "text/plain" });
    fireEvent.change(fileInput, { target: { files: [badFile] } });

    await screen.findByText("Only PDF, DOC, and DOCX files are supported.");
    await waitFor(() => {
      expect(mocked.uploadDocument).not.toHaveBeenCalled();
    });
  });
});
