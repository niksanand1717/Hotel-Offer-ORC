import type { HotelOffer, SupplierResult } from './types';

/**
 * De-duplicates hotels across suppliers by name and keeps the cheapest offer.
 *
 * Names are matched case- and whitespace-insensitively ("Holtin" == " holtin ").
 * On a price tie the offer with the higher commission wins, then the supplier
 * name decides, so the result is deterministic regardless of input order.
 *
 * Pure and side-effect free, so it is safe to call from a Temporal workflow.
 */
export function selectBestOffers(results: SupplierResult[]): HotelOffer[] {
  const best = new Map<string, HotelOffer>();

  for (const { supplier, hotels } of results) {
    for (const hotel of hotels) {
      const key = hotel.name.trim().toLowerCase();
      const candidate: HotelOffer = {
        name: hotel.name.trim(),
        price: hotel.price,
        supplier,
        commissionPct: hotel.commissionPct,
      };
      const current = best.get(key);
      if (!current || isBetter(candidate, current)) {
        best.set(key, candidate);
      }
    }
  }

  return [...best.values()].sort(
    (a, b) => a.price - b.price || a.name.localeCompare(b.name),
  );
}

function isBetter(candidate: HotelOffer, current: HotelOffer): boolean {
  if (candidate.price !== current.price) {
    return candidate.price < current.price;
  }
  if (candidate.commissionPct !== current.commissionPct) {
    return candidate.commissionPct > current.commissionPct;
  }
  return candidate.supplier < current.supplier;
}
