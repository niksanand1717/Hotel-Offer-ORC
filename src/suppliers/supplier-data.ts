import type { SupplierHotel, SupplierId } from '../common/types';

/**
 * Static inventory for the two mock suppliers. Names deliberately overlap
 * between A and B (with differing prices) so the orchestrator has something
 * to compare. Bangalore is only served by Supplier B.
 */
export const SUPPLIER_INVENTORY: Record<SupplierId, SupplierHotel[]> = {
  A: [
    {
      hotelId: 'a1',
      name: 'Holtin',
      price: 6000,
      city: 'delhi',
      commissionPct: 10,
    },
    {
      hotelId: 'a2',
      name: 'Radison',
      price: 5900,
      city: 'delhi',
      commissionPct: 13,
    },
    {
      hotelId: 'a3',
      name: 'Taj Palace',
      price: 12500,
      city: 'delhi',
      commissionPct: 15,
    },
    {
      hotelId: 'a4',
      name: 'Lemon Tree',
      price: 3200,
      city: 'delhi',
      commissionPct: 8,
    },
    {
      hotelId: 'a5',
      name: 'The Leela',
      price: 11000,
      city: 'delhi',
      commissionPct: 12,
    },
    {
      hotelId: 'a6',
      name: 'Trident',
      price: 8700,
      city: 'mumbai',
      commissionPct: 14,
    },
    {
      hotelId: 'a7',
      name: 'Holtin',
      price: 7200,
      city: 'mumbai',
      commissionPct: 10,
    },
    {
      hotelId: 'a8',
      name: 'Fern Residency',
      price: 4100,
      city: 'mumbai',
      commissionPct: 9,
    },
  ],
  B: [
    {
      hotelId: 'b1',
      name: 'Holtin',
      price: 5340,
      city: 'delhi',
      commissionPct: 20,
    },
    {
      hotelId: 'b2',
      name: 'Radison',
      price: 6100,
      city: 'delhi',
      commissionPct: 12,
    },
    {
      hotelId: 'b3',
      name: 'The Oberoi',
      price: 9800,
      city: 'delhi',
      commissionPct: 18,
    },
    {
      hotelId: 'b4',
      name: 'Lemon Tree',
      price: 3200,
      city: 'delhi',
      commissionPct: 11,
    },
    {
      hotelId: 'b5',
      name: 'The Leela',
      price: 11450,
      city: 'delhi',
      commissionPct: 16,
    },
    {
      hotelId: 'b6',
      name: 'Trident',
      price: 8250,
      city: 'mumbai',
      commissionPct: 12,
    },
    {
      hotelId: 'b7',
      name: 'Fern Residency',
      price: 4300,
      city: 'mumbai',
      commissionPct: 15,
    },
    {
      hotelId: 'b8',
      name: 'ITC Gardenia',
      price: 9900,
      city: 'bangalore',
      commissionPct: 17,
    },
    {
      hotelId: 'b9',
      name: 'Radison',
      price: 6400,
      city: 'bangalore',
      commissionPct: 11,
    },
  ],
};
