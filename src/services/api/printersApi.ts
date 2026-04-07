import { apiRequest } from './httpClient';

export type PrinterListItem = {
  id: string;
  name: string;
  status?: string;
  supportsColor?: boolean;
  supportsDoubleSided?: boolean;
  paperSizes?: string[];
};

export function getShopPrinters(shopId: string): Promise<PrinterListItem[]> {
  return apiRequest(
    `/print-shops/${encodeURIComponent(shopId)}/printers`,
    { method: 'GET' },
    { auth: false },
  );
}