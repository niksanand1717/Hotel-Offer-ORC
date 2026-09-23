import * as dotenv from 'dotenv';

dotenv.config({ quiet: true });

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw ? Number.parseInt(raw, 10) : fallback;
  return Number.isFinite(value) ? value : fallback;
}

const port = int('PORT', 3000);

export const config = {
  port,
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  hotelCacheTtlSeconds: int('HOTEL_CACHE_TTL_SECONDS', 300),
  temporal: {
    address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? 'hotel-offers',
    /** Temporal Cloud API key auth (enables TLS). */
    apiKey: process.env.TEMPORAL_API_KEY || undefined,
    /** Temporal Cloud mTLS auth: paths to the client cert and key (enables TLS). */
    tlsCertPath: process.env.TEMPORAL_TLS_CERT_PATH || undefined,
    tlsKeyPath: process.env.TEMPORAL_TLS_KEY_PATH || undefined,
  },
  /** Base URL the worker/health check use to reach the mock supplier endpoints. */
  supplierBaseUrl: process.env.SUPPLIER_BASE_URL ?? `http://localhost:${port}`,
  supplierTimeoutMs: int('SUPPLIER_TIMEOUT_MS', 3000),
  /**
   * Port for the worker's health endpoint. Cloud Run (which sets K_SERVICE)
   * requires every service to listen on $PORT, so it defaults to that there.
   */
  workerHealthPort: process.env.WORKER_HEALTH_PORT
    ? int('WORKER_HEALTH_PORT', 8080)
    : process.env.K_SERVICE
      ? port
      : undefined,
  /** Comma-separated supplier ids (e.g. "A") that start in the "down" state. */
  suppliersDown: (process.env.SUPPLIERS_DOWN ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
};
