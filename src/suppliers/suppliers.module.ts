import { Module } from '@nestjs/common';
import { SupplierStatusService } from './supplier-status.service';
import { SuppliersController } from './suppliers.controller';

@Module({
  controllers: [SuppliersController],
  providers: [SupplierStatusService],
})
export class SuppliersModule {}
