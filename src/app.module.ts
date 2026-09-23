import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { HotelsModule } from './hotels/hotels.module';
import { RedisModule } from './redis/redis.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { TemporalModule } from './temporal/temporal.module';

@Module({
  imports: [RedisModule, TemporalModule, SuppliersModule, HotelsModule],
  controllers: [HealthController],
})
export class AppModule {}
