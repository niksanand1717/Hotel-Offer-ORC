import { Logger } from '@nestjs/common';
import { NativeConnection, Worker } from '@temporalio/worker';
import Redis from 'ioredis';
import { createServer, type Server } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { config } from './config';
import { HotelOfferStore } from './redis/hotel-offer.store';
import { createActivities } from './temporal/activities';
import { temporalConnectionOptions } from './temporal/connection-options';

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

  const connection = await connectWithRetry();
  const worker = await Worker.create({
    connection,
    namespace: config.temporal.namespace,
    taskQueue: config.temporal.taskQueue,
    workflowsPath: require.resolve('./temporal/workflows'),
    activities: createActivities({
      store: new HotelOfferStore(redis, config.hotelCacheTtlSeconds),
      supplierBaseUrl: config.supplierBaseUrl,
      supplierTimeoutMs: config.supplierTimeoutMs,
    }),
  });

  current.worker = worker;

  logger.log(
    `Worker polling task queue "${config.temporal.taskQueue}" on ${config.temporal.address}`,
  );
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
