import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { HotelOffer } from '../common/types';
import { HotelsQueryDto } from './hotels-query.dto';
import { HotelsService } from './hotels.service';

@Controller('api/hotels')
export class HotelsController {
  constructor(private readonly hotels: HotelsService) {}

  /** GET /api/hotels?city=delhi[&minPrice=..&maxPrice=..] */
  @Get()
  async list(
    @Query() query: HotelsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<HotelOffer[]> {
    const { hotels, failedSuppliers } = await this.hotels.findHotels(query);
    // The body stays a plain array; partial results are flagged via a header.
    if (failedSuppliers.length > 0) {
      res.setHeader('X-Failed-Suppliers', failedSuppliers.join(', '));
    }
    return hotels;
  }
}
