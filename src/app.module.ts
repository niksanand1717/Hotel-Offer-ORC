import { Module } from '@nestjs/common';
import { config } from './config';
import { HealthController } from './health/health.controller';
import { HotelsModule } from './hotels/hotels.module';
import { RedisModule } from './redis/redis.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { InProcessWorkerModule } from './temporal/in-process-worker.module';
import { TemporalModule } from './temporal/temporal.module';

@Module({
  imports: [
    RedisModule,
    TemporalModule,
    SuppliersModule,
    HotelsModule,
    ...(config.runWorker ? [InProcessWorkerModule] : []),
  ],
  controllers: [HealthController],
})
export class AppModule {}
