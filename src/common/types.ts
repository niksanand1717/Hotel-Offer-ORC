export type SupplierId = 'A' | 'B';

export const SUPPLIER_IDS: readonly SupplierId[] = ['A', 'B'];

export function supplierName(id: SupplierId): string {
  return `Supplier ${id}`;
}

/** Raw hotel record as returned by a supplier API. */
export interface SupplierHotel {
  hotelId: string;
  name: string;
  price: number;
  city: string;
  commissionPct: number;
}

/** De-duplicated, best-priced offer returned to clients. */
export interface HotelOffer {
  name: string;
  price: number;
  supplier: string;
  commissionPct: number;
}

export interface SupplierResult {
  supplier: string;
  hotels: SupplierHotel[];
}

export interface HotelOffersWorkflowInput {
  city: string;
}

export interface HotelOffersWorkflowOutput {
  city: string;
  hotels: HotelOffer[];
  failedSuppliers: string[];
}

export function normalizeCity(city: string): string {
  return city.trim().toLowerCase();
}
