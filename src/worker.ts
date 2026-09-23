import { Logger } from '@nestjs/common';
import type { Worker } from '@temporalio/worker';
import Redis from 'ioredis';
import { createServer, type Server } from 'node:http';
import { config } from './config';
import { HotelOfferStore } from './redis/hotel-offer.store';
import { createHotelOffersWorker } from './temporal/worker-factory';

const logger = new Logger('TemporalWorker');

/** Minimal HTTP health endpoint: 200 while the worker is polling, else 503. */
function startHealthServer(port: number, getState: () => string): Server {
  const server = createServer((_req, res) => {
    const state = getState();
    res.writeHead(state === 'RUNNING' ? 200 : 503, {
      'Content-Type': 'application/json',
    });
    res.end(JSON.stringify({ worker: state }));
  });
  server.listen(port, () => logger.log(`Health endpoint on port ${port}`));
  return server;
}

async function run(): Promise<void> {
  const current: { worker?: Worker } = {};
  // Listen before connecting so Cloud Run's startup probe sees the port.
  const healthServer =
    config.workerHealthPort === undefined
      ? undefined
      : startHealthServer(
          config.workerHealthPort,
          () => current.worker?.getState() ?? 'STARTING',
        );

  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2 });
  redis.on('error', (err) => logger.error(`Redis: ${err.message}`));

  const { worker, connection } = await createHotelOffersWorker(
    new HotelOfferStore(redis, config.hotelCacheTtlSeconds),
  );
  current.worker = worker;

  try {
    // Resolves after SIGINT/SIGTERM once in-flight tasks drain.
    await worker.run();
  } finally {
    healthServer?.close();
    await connection.close();
    await redis.quit().catch(() => undefined);
  }
}

run().catch((err) => {
  logger.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
