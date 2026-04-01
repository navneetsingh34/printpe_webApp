import { apiRequest } from './httpClient';
import { PrintShop, ShopPricingConfig } from '../../shared/types/shop';

function toQuery(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') query.set(k, String(v));
  });
  const value = query.toString();
  return value ? `?${value}` : '';
}

export function getAllShops(): Promise<PrintShop[]> {
  return apiRequest('/print-shops', { method: 'GET' }, { auth: false });
}
export function searchShops(name: string): Promise<PrintShop[]> {
  return apiRequest(`/print-shops/search${toQuery({ name })}`, { method: 'GET' }, { auth: false });
}
export function getNearbyShops(lat: number, lng: number, radius = 3): Promise<PrintShop[]> {
  return apiRequest(`/print-shops/nearby${toQuery({ lat, lng, radius })}`, { method: 'GET' }, { auth: false });
}
export function getShopPricing(shopId: string): Promise<ShopPricingConfig> {
  return apiRequest(`/print-shops/${encodeURIComponent(shopId)}/pricing`, { method: 'GET' }, { auth: false });
}
