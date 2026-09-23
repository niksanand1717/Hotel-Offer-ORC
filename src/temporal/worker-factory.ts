import { Logger } from '@nestjs/common';
import { NativeConnection, Worker } from '@temporalio/worker';
import { setTimeout as sleep } from 'node:timers/promises';
import { config } from '../config';
import type { HotelOfferStore } from '../redis/hotel-offer.store';
import { createActivities } from './activities';
import { temporalConnectionOptions } from './connection-options';

const logger = new Logger('TemporalWorker');

/** Temporal can take a while to boot (e.g. in docker compose), so retry. */
async function connectWithRetry(attempts = 30): Promise<NativeConnection> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await NativeConnection.connect(temporalConnectionOptions());
    } catch (err) {
      if (attempt >= attempts) throw err;
      logger.warn(
        `Temporal not reachable at ${config.temporal.address} (attempt ${attempt}/${attempts}): ${String(err)}`,
      );
      await sleep(2000);
    }
  }
}

/**
 * Connects to Temporal and creates the hotel-offers worker. Used both by the
 * standalone worker process (src/worker.ts) and by the API when RUN_WORKER=true.
 * The caller runs it with `worker.run()` and closes `connection` afterwards.
 */
export async function createHotelOffersWorker(
  store: HotelOfferStore,
): Promise<{ worker: Worker; connection: NativeConnection }> {
  const connection = await connectWithRetry();
  try {
    const worker = await Worker.create({
      connection,
      namespace: config.temporal.namespace,
      taskQueue: config.temporal.taskQueue,
      workflowsPath: require.resolve('./workflows'),
      activities: createActivities({
        store,
        supplierBaseUrl: config.supplierBaseUrl,
        supplierTimeoutMs: config.supplierTimeoutMs,
      }),
    });
    logger.log(
      `Worker polling task queue "${config.temporal.taskQueue}" on ${config.temporal.address}`,
    );
    return { worker, connection };
  } catch (err) {
    await connection.close();
    throw err;
  }
}
