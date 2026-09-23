import { IsBoolean } from 'class-validator';

/** Body of PUT /admin/suppliers/:id */
export class SupplierStatusDto {
  @IsBoolean({ message: 'available must be true or false' })
  available!: boolean;
}
