import {
  Injectable,
  Logger,
  Module,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { NativeConnection, Worker } from '@temporalio/worker';
import { HotelOfferStore } from '../redis/hotel-offer.store';
import { createHotelOffersWorker } from './worker-factory';

/**
 * Runs the Temporal worker inside the API process (RUN_WORKER=true), so a
 * single container — e.g. one Cloud Run service — serves both roles.
 */
@Injectable()
export class InProcessWorkerService
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(InProcessWorkerService.name);
  private worker?: Worker;
  private connection?: NativeConnection;
  private running?: Promise<void>;

  constructor(private readonly store: HotelOfferStore) {}

  onApplicationBootstrap(): void {
    // Start in the background so the HTTP server doesn't wait for Temporal.
    this.running = this.run();
  }

  private async run(): Promise<void> {
    try {
      ({ worker: this.worker, connection: this.connection } =
        await createHotelOffersWorker(this.store));
      await this.worker.run();
    } catch (err) {
      // A container whose worker died would silently time out every request;
      // exit so the platform (Cloud Run, compose) replaces it.
      this.logger.error(
        `Worker stopped unexpectedly: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
      process.exit(1);
    } finally {
      await this.connection?.close().catch(() => undefined);
    }
  }

  /** Drains in-flight tasks before Redis and the Temporal client close. */
  async beforeApplicationShutdown(): Promise<void> {
    // Temporal also reacts to SIGTERM itself; only request shutdown once.
    if (this.worker?.getState() === 'RUNNING') {
      this.worker.shutdown();
    }
    await this.running;
  }
}

@Module({ providers: [InProcessWorkerService] })
export class InProcessWorkerModule {}
