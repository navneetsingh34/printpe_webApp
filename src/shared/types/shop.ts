export type TieredRate = {
  firstNPages: number;
  firstNRate: number;
  afterNRate: number;
};

export type PaperPricing = {
  paperSize: string;
  enabled: boolean;
  bw: TieredRate;
  color: TieredRate;
  doubleSidedDiscountPercent: number;
};

export type BindingPricing = {
  id: string;
  label: string;
  price: number;
  enabled: boolean;
};

export type ShopPricingConfig = {
  paperPricing: PaperPricing[];
  bindings: BindingPricing[];
};

export type PrintShop = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  phone: string;
  email: string;
  openingTime: string;
  closingTime: string;
  isActive: boolean;
  image?: string | null;
  pricingConfig?: ShopPricingConfig | null;
  distance?: number;
};
