import { Injectable, Logger } from '@nestjs/common';
import { config } from '../config';
import { SUPPLIER_IDS, type SupplierId } from '../common/types';

/** In-memory availability switch used to simulate a supplier outage. */
@Injectable()
export class SupplierStatusService {
  private readonly logger = new Logger(SupplierStatusService.name);
  private readonly available = new Map<SupplierId, boolean>(
    SUPPLIER_IDS.map((id) => [id, !config.suppliersDown.includes(id)]),
  );

  isAvailable(id: SupplierId): boolean {
    return this.available.get(id) ?? false;
  }

  setAvailable(id: SupplierId, available: boolean): void {
    this.available.set(id, available);
    this.logger.warn(`Supplier ${id} marked ${available ? 'UP' : 'DOWN'}`);
  }

  snapshot(): Record<SupplierId, boolean> {
    return Object.fromEntries(this.available) as Record<SupplierId, boolean>;
  }
}
