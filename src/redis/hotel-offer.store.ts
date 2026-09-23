import type Redis from 'ioredis';
import { normalizeCity, type HotelOffer } from '../common/types';

/**
 * Filters by price entirely inside Redis: ZRANGEBYSCORE on the price index,
 * then HMGET the matching offers, in one atomic round trip.
 */
const FILTER_BY_PRICE_SCRIPT = `
local keys = redis.call('ZRANGEBYSCORE', KEYS[1], ARGV[1], ARGV[2])
if #keys == 0 then return {} end
return redis.call('HMGET', KEYS[2], unpack(keys))
`;

type RedisWithScripts = Redis & {
  filterHotelsByPrice(
    priceIndexKey: string,
    offersKey: string,
    min: string,
    max: string,
  ): Promise<(string | null)[]>;
};

/**
 * Stores the de-duplicated offers for a city as:
 *   hotels:{city}:by_price  sorted set  member = hotel key, score = price
 *   hotels:{city}:offers    hash        hotel key -> offer JSON
 * The `{city}` hash tag keeps both keys in the same Redis Cluster slot.
 */
export class HotelOfferStore {
  private readonly redis: RedisWithScripts;

  constructor(
    redis: Redis,
    private readonly ttlSeconds: number,
  ) {
    redis.defineCommand('filterHotelsByPrice', {
      numberOfKeys: 2,
      lua: FILTER_BY_PRICE_SCRIPT,
    });
    this.redis = redis as RedisWithScripts;
  }

  /** Atomically replaces the stored offers for a city. */
  async save(city: string, offers: HotelOffer[]): Promise<void> {
    const { priceIndexKey, offersKey } = keysFor(city);
    const tx = this.redis.multi().del(priceIndexKey, offersKey);

    if (offers.length > 0) {
      const zaddArgs: (string | number)[] = [];
      const hashEntries: Record<string, string> = {};
      for (const offer of offers) {
        const key = offer.name.toLowerCase();
        zaddArgs.push(offer.price, key);
        hashEntries[key] = JSON.stringify(offer);
      }
      tx.zadd(priceIndexKey, ...zaddArgs)
        .hset(offersKey, hashEntries)
        .expire(priceIndexKey, this.ttlSeconds)
        .expire(offersKey, this.ttlSeconds);
    }

    const results = await tx.exec();
    const failed = results?.find(([err]) => err);
    if (!results || failed) {
      throw failed?.[0] ?? new Error('Redis transaction aborted');
    }
  }

  /** Returns offers for a city with minPrice <= price <= maxPrice, cheapest first. */
  async findByPrice(
    city: string,
    minPrice?: number,
    maxPrice?: number,
  ): Promise<HotelOffer[]> {
    const { priceIndexKey, offersKey } = keysFor(city);
    const raw = await this.redis.filterHotelsByPrice(
      priceIndexKey,
      offersKey,
      minPrice === undefined ? '-inf' : String(minPrice),
      maxPrice === undefined ? '+inf' : String(maxPrice),
    );
    return raw
      .filter((json): json is string => json !== null)
      .map((json) => JSON.parse(json) as HotelOffer);
  }
}

function keysFor(city: string) {
  const tag = `{${normalizeCity(city)}}`;
  return {
    priceIndexKey: `hotels:${tag}:by_price`,
    offersKey: `hotels:${tag}:offers`,
  };
}
