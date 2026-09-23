import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import Redis from 'ioredis';
import { config } from '../config';
import { HotelOfferStore } from './hotel-offer.store';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => {
        const logger = new Logger('Redis');
        const redis = new Redis(config.redisUrl, {
          maxRetriesPerRequest: 2,
          lazyConnect: true,
        });
        redis.on('error', (err) => logger.error(err.message));
        redis.on('ready', () =>
          logger.log(
            `Connected to ${config.redisUrl.includes('local') ? 'local-redis' : 'Upstash Redis'}`,
          ),
        );
        redis.connect().catch(() => {
          // Reconnection is handled by ioredis; errors are logged above.
        });
        return redis;
      },
    },
    {
      provide: HotelOfferStore,
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis) =>
        new HotelOfferStore(redis, config.hotelCacheTtlSeconds),
    },
  ],
  exports: [REDIS_CLIENT, HotelOfferStore],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}
