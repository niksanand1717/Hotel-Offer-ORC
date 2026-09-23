import { Controller, Get, Inject, Res } from '@nestjs/common';
import { Client } from '@temporalio/client';
import type { Response } from 'express';
import type Redis from 'ioredis';
import { SUPPLIER_IDS, supplierName, type SupplierId } from '../common/types';
import { config } from '../config';
import { REDIS_CLIENT } from '../redis/redis.module';
import { TEMPORAL_CLIENT } from '../temporal/temporal.module';

interface CheckResult {
  status: 'up' | 'down';
  latencyMs: number;
  error?: string;
  [extra: string]: unknown;
}

const CHECK_TIMEOUT_MS = 2000;

@Controller('health')
export class HealthController {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(TEMPORAL_CLIENT) private readonly temporal: Client,
  ) {}

  /**
   * 200 "ok"       – everything up
   * 200 "degraded" – one supplier down (API still serves partial results)
   * 503 "down"     – no supplier, Redis or Temporal unavailable
   */
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const [supplierResults, redis, temporal] = await Promise.all([
      Promise.all(SUPPLIER_IDS.map((id) => this.checkSupplier(id))),
      timed(async () => {
        await this.redis.ping();
      }),
      timed(async () => {
        await this.temporal.connection.workflowService.getSystemInfo({});
      }),
    ]);

    const suppliers = Object.fromEntries(
      SUPPLIER_IDS.map((id, i) => [supplierName(id), supplierResults[i]]),
    );
    const suppliersUp = supplierResults.filter((r) => r.status === 'up').length;
    const infraUp = redis.status === 'up' && temporal.status === 'up';

    const status =
      !infraUp || suppliersUp === 0
        ? 'down'
        : suppliersUp < SUPPLIER_IDS.length
          ? 'degraded'
          : 'ok';
    res.status(status === 'down' ? 503 : 200);

    return {
      status,
      timestamp: new Date().toISOString(),
      suppliers,
      dependencies: { redis, temporal },
    };
  }

  private checkSupplier(id: SupplierId): Promise<CheckResult> {
    return timed(async () => {
      const response = await fetch(
        `${config.supplierBaseUrl}/supplier${id}/hotels`,
        { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) },
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const hotels = (await response.json()) as unknown[];
      return { hotels: hotels.length };
    });
  }
}

async function timed(
  fn: () => Promise<Record<string, unknown> | void>,
): Promise<CheckResult> {
  const started = Date.now();
  try {
    const extra = await withTimeout(fn(), CHECK_TIMEOUT_MS);
    return { status: 'up', latencyMs: Date.now() - started, ...(extra ?? {}) };
  } catch (err) {
    return {
      status: 'down',
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
