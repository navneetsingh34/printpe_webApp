import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PrintPage } from "./PrintPage";

const mocked = vi.hoisted(() => ({
  getAllShops: vi.fn(),
  getShopPricing: vi.fn(),
  getShopPrinters: vi.fn(),
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

vi.mock("../../services/api/printersApi", () => ({
  getShopPrinters: mocked.getShopPrinters,
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

beforeAll(() => {
  Object.defineProperty(window.URL, "createObjectURL", {
    value: vi.fn(() => "blob:mock-url"),
    writable: true,
  });
  Object.defineProperty(window.URL, "revokeObjectURL", {
    value: vi.fn(),
    writable: true,
  });
});

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

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const badFile = new File(["x"], "notes.txt", { type: "text/plain" });
    fireEvent.change(fileInput, { target: { files: [badFile] } });

    await screen.findByText("Only PDF, JPG, and PNG files are supported.");
    await waitFor(() => {
      expect(mocked.uploadDocument).not.toHaveBeenCalled();
    });
  });

  it("defaults multiple uploaded images to separate pages", async () => {
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

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const firstPhoto = new File(["first"], "first.png", { type: "image/png" });
    const secondPhoto = new File(["second"], "second.png", {
      type: "image/png",
    });
    fireEvent.change(fileInput, {
      target: { files: [firstPhoto, secondPhoto] },
    });

    await screen.findByRole("heading", { name: "Page 1" });
    await screen.findByRole("heading", { name: "Page 2" });
  });

  it("blocks payment when no color printer is available for the selected shop", async () => {
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
    mocked.getShopPrinters.mockResolvedValue([
      {
        status: "online",
        supportsColor: false,
        supportsDoubleSided: true,
        paperSizes: ["A4"],
      },
    ]);

    const { container } = render(
      <MemoryRouter>
        <PrintPage />
      </MemoryRouter>,
    );

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const firstPhoto = new File(["first"], "first.png", { type: "image/png" });
    fireEvent.change(fileInput, {
      target: { files: [firstPhoto] },
    });

    const radios = container.querySelectorAll('input[type="radio"]');
    fireEvent.click(radios[1]);

    fireEvent.click(
      await screen.findByRole("button", { name: "Pay with Razorpay" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "No color printer is online. Please choose another shop.",
        ),
      ).toBeInTheDocument();
    });
    expect(mocked.createPrintJob).not.toHaveBeenCalled();
    expect(mocked.createPaymentOrder).not.toHaveBeenCalled();
  });

  it("blocks payment when no black and white printer is available for the selected shop", async () => {
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
    mocked.getShopPrinters.mockResolvedValue([
      {
        status: "online",
        supportsColor: true,
        supportsDoubleSided: true,
        paperSizes: ["A4"],
      },
    ]);

    const { container } = render(
      <MemoryRouter>
        <PrintPage />
      </MemoryRouter>,
    );

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const firstPhoto = new File(["first"], "first.png", { type: "image/png" });
    fireEvent.change(fileInput, {
      target: { files: [firstPhoto] },
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Pay with Razorpay" }),
    );

    await screen.findByText(
      "No B&W printer is online. Please choose another shop.",
    );
    expect(mocked.createPrintJob).not.toHaveBeenCalled();
    expect(mocked.createPaymentOrder).not.toHaveBeenCalled();
  });
});
