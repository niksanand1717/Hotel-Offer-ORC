import { ApplicationFailure, log, proxyActivities } from '@temporalio/workflow';
import { selectBestOffers } from '../common/select-best-offers';
import {
  normalizeCity,
  SUPPLIER_IDS,
  supplierName,
  type HotelOffersWorkflowInput,
  type HotelOffersWorkflowOutput,
  type SupplierResult,
} from '../common/types';
import type { Activities } from './activities';
import { ALL_SUPPLIERS_DOWN } from './constants';

const { fetchSupplierHotels } = proxyActivities<Activities>({
  startToCloseTimeout: '5 seconds',
  retry: {
    initialInterval: '200 milliseconds',
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

const { saveHotelOffers } = proxyActivities<Activities>({
  startToCloseTimeout: '5 seconds',
  retry: { initialInterval: '200 milliseconds', maximumAttempts: 5 },
});

/**
 * Fetches hotels from every supplier in parallel, keeps the cheapest offer per
 * hotel name and caches the result in Redis. A failing supplier is tolerated
 * as long as at least one supplier answers.
 */
export async function hotelOffersWorkflow(
  input: HotelOffersWorkflowInput,
): Promise<HotelOffersWorkflowOutput> {
  const city = normalizeCity(input.city);
  log.info('Fetching supplier offers', { city });

  const settled = await Promise.allSettled(
    SUPPLIER_IDS.map((id) => fetchSupplierHotels(id, city)),
  );

  const results: SupplierResult[] = [];
  const failedSuppliers: string[] = [];
  settled.forEach((outcome, i) => {
    const supplier = supplierName(SUPPLIER_IDS[i]);
    if (outcome.status === 'fulfilled') {
      results.push(outcome.value);
    } else {
      failedSuppliers.push(supplier);
      log.warn(`${supplier} failed after retries; continuing without it`, {
        city,
        error: String(outcome.reason),
      });
    }
  });

  if (results.length === 0) {
    throw ApplicationFailure.nonRetryable(
      'All suppliers are unavailable',
      ALL_SUPPLIERS_DOWN,
      { failedSuppliers },
    );
  }

  const hotels = selectBestOffers(results);
  await saveHotelOffers(city, hotels);

  log.info('Selected best offers', {
    city,
    hotels: hotels.length,
    failedSuppliers,
  });
  return { city, hotels, failedSuppliers };
}
