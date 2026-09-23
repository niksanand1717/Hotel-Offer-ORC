import { ApplicationFailure, log } from '@temporalio/activity';
import {
  supplierName,
  type HotelOffer,
  type SupplierHotel,
  type SupplierId,
  type SupplierResult,
} from '../common/types';
import type { HotelOfferStore } from '../redis/hotel-offer.store';

export interface ActivityDeps {
  store: HotelOfferStore;
  supplierBaseUrl: string;
  supplierTimeoutMs: number;
}

export function createActivities({
  store,
  supplierBaseUrl,
  supplierTimeoutMs,
}: ActivityDeps) {
  return {
    async fetchSupplierHotels(
      supplierId: SupplierId,
      city: string,
    ): Promise<SupplierResult> {
      const supplier = supplierName(supplierId);
      const url = `${supplierBaseUrl}/supplier${supplierId}/hotels?city=${encodeURIComponent(city)}`;
      const started = Date.now();

      let response: Response;
      try {
        response = await fetch(url, {
          signal: AbortSignal.timeout(supplierTimeoutMs),
        });
      } catch (err) {
        // Network errors and timeouts are transient: let Temporal retry them.
        log.warn(`${supplier} request failed`, { url, error: String(err) });
        throw err;
      }

      if (!response.ok) {
        const message = `${supplier} responded with HTTP ${response.status}`;
        log.warn(message, { url });
        if (response.status >= 400 && response.status < 500) {
          throw ApplicationFailure.nonRetryable(message, 'SupplierClientError');
        }
        throw ApplicationFailure.retryable(message, 'SupplierServerError');
      }

      const body: unknown = await response.json();
      if (!Array.isArray(body)) {
        throw ApplicationFailure.nonRetryable(
          `${supplier} returned a non-array payload`,
          'SupplierInvalidPayload',
        );
      }
      const hotels = body.filter(isValidHotel);
      if (hotels.length !== body.length) {
        log.warn(
          `${supplier} returned malformed hotel records; skipping them`,
          {
            dropped: body.length - hotels.length,
          },
        );
      }

      log.info(`${supplier} returned ${hotels.length} hotels`, {
        city,
        durationMs: Date.now() - started,
      });
      return { supplier, hotels };
    },

    async saveHotelOffers(city: string, offers: HotelOffer[]): Promise<void> {
      await store.save(city, offers);
      log.info(`Cached ${offers.length} offers in Redis`, { city });
    },
  };
}

export type Activities = ReturnType<typeof createActivities>;

function isValidHotel(value: unknown): value is SupplierHotel {
  const h = value as Partial<SupplierHotel> | null;
  return (
    typeof h?.name === 'string' &&
    h.name.trim().length > 0 &&
    typeof h.price === 'number' &&
    Number.isFinite(h.price) &&
    h.price >= 0 &&
    typeof h.commissionPct === 'number'
  );
}
