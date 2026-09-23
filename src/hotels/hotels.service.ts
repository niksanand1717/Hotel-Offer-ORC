import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Client, WorkflowFailedError } from '@temporalio/client';
import { ApplicationFailure } from '@temporalio/common';
import { randomUUID } from 'node:crypto';
import type { HotelOffer, HotelOffersWorkflowOutput } from '../common/types';
import { config } from '../config';
import { HotelOfferStore } from '../redis/hotel-offer.store';
import { ALL_SUPPLIERS_DOWN } from '../temporal/constants';
import { TEMPORAL_CLIENT } from '../temporal/temporal.module';
import type { hotelOffersWorkflow } from '../temporal/workflows';
import type { HotelsQueryDto } from './hotels-query.dto';

export interface HotelsResult {
  hotels: HotelOffer[];
  failedSuppliers: string[];
}

@Injectable()
export class HotelsService {
  private readonly logger = new Logger(HotelsService.name);

  constructor(
    @Inject(TEMPORAL_CLIENT) private readonly temporal: Client,
    private readonly store: HotelOfferStore,
  ) {}

  /**
   * Runs the orchestration workflow (which refreshes Redis with the
   * de-duplicated list), then applies the price filter inside Redis.
   */
  async findHotels({
    city,
    minPrice,
    maxPrice,
  }: HotelsQueryDto): Promise<HotelsResult> {
    const { failedSuppliers } = await this.runWorkflow(city);

    try {
      const hotels = await this.store.findByPrice(city, minPrice, maxPrice);
      return { hotels, failedSuppliers };
    } catch (err) {
      this.logger.error(`Redis query failed for city=${city}: ${String(err)}`);
      throw new ServiceUnavailableException('Hotel cache is unavailable');
    }
  }

  private async runWorkflow(city: string): Promise<HotelOffersWorkflowOutput> {
    const workflowId = `hotel-offers-${city.replace(/\W+/g, '-')}-${randomUUID()}`;
    const started = Date.now();
    try {
      const output = await this.temporal.workflow.execute<
        typeof hotelOffersWorkflow
      >('hotelOffersWorkflow', {
        workflowId,
        taskQueue: config.temporal.taskQueue,
        args: [{ city }],
        workflowExecutionTimeout: '30 seconds',
      });
      this.logger.log(
        `Workflow ${workflowId} returned ${output.hotels.length} hotels in ${Date.now() - started}ms` +
          (output.failedSuppliers.length
            ? ` (failed: ${output.failedSuppliers.join(', ')})`
            : ''),
      );
      return output;
    } catch (err) {
      if (
        err instanceof WorkflowFailedError &&
        err.cause instanceof ApplicationFailure &&
        err.cause.type === ALL_SUPPLIERS_DOWN
      ) {
        this.logger.warn(`Workflow ${workflowId}: all suppliers unavailable`);
        throw new BadGatewayException('All hotel suppliers are unavailable');
      }
      this.logger.error(
        `Workflow ${workflowId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException(
        'Hotel offer orchestration is currently unavailable',
      );
    }
  }
}
