declare global {
  type RazorpayPaymentSuccessResponse = {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  };

  type RazorpayPaymentFailureResponse = {
    error?: {
      code?: string;
      description?: string;
      reason?: string;
      source?: string;
      step?: string;
      metadata?: {
        order_id?: string;
        payment_id?: string;
      };
    };
  };

  type RazorpayCheckoutOptions = {
    key: string;
    amount: string | number;
    currency: string;
    name: string;
    description?: string;
    order_id: string;
    prefill?: {
      name?: string;
      email?: string;
      contact?: string;
    };
    notes?: Record<string, string>;
    theme?: {
      color?: string;
    };
    handler?: (response: RazorpayPaymentSuccessResponse) => void;
    modal?: {
      ondismiss?: () => void;
    };
  };

  type RazorpayCheckoutInstance = {
    open: () => void;
    on: (
      eventName: "payment.failed",
      handler: (response: RazorpayPaymentFailureResponse) => void,
    ) => void;
  };

  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckoutInstance;
  }
}

export {};
