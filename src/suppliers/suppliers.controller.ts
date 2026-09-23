import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  normalizeCity,
  SUPPLIER_IDS,
  type SupplierHotel,
  type SupplierId,
} from '../common/types';
import { SUPPLIER_INVENTORY } from './supplier-data';
import { SupplierStatusDto } from './supplier-status.dto';
import { SupplierStatusService } from './supplier-status.service';

/** Mock supplier APIs: GET /supplierA/hotels and GET /supplierB/hotels. */
@Controller()
export class SuppliersController {
  constructor(private readonly status: SupplierStatusService) {}

  @Get('supplierA/hotels')
  supplierA(@Query('city') city?: string): SupplierHotel[] {
    return this.hotelsFor('A', city);
  }

  @Get('supplierB/hotels')
  supplierB(@Query('city') city?: string): SupplierHotel[] {
    return this.hotelsFor('B', city);
  }

  /** Toggle a mock supplier up/down, e.g. PUT /admin/suppliers/A {"available": false}. */
  @Put('admin/suppliers/:id')
  setStatus(
    @Param('id') rawId: string,
    @Body() { available }: SupplierStatusDto,
  ): { supplier: string; available: boolean } {
    const id = rawId.toUpperCase() as SupplierId;
    if (!SUPPLIER_IDS.includes(id)) {
      throw new NotFoundException(`Unknown supplier "${rawId}"`);
    }
    this.status.setAvailable(id, available);
    return { supplier: `Supplier ${id}`, available };
  }

  private hotelsFor(id: SupplierId, city?: string): SupplierHotel[] {
    if (!this.status.isAvailable(id)) {
      throw new ServiceUnavailableException(`Supplier ${id} is unavailable`);
    }
    const inventory = SUPPLIER_INVENTORY[id];
    if (!city) {
      return inventory;
    }
    const wanted = normalizeCity(city);
    return inventory.filter((hotel) => hotel.city === wanted);
  }
}
