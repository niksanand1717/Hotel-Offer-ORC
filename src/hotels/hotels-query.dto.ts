import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  Validate,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { normalizeCity } from '../common/types';

/** Query strings arrive as strings; "" means "not set". Arrays become NaN and fail. */
const toOptionalNumber = ({ value }: { value: unknown }) =>
  value === undefined || value === '' ? undefined : Number(value);

@ValidatorConstraint({ name: 'minPriceLteMaxPrice' })
class MinPriceLteMaxPrice implements ValidatorConstraintInterface {
  validate(maxPrice: number | undefined, { object }: ValidationArguments) {
    const { minPrice } = object as HotelsQueryDto;
    return (
      minPrice === undefined || maxPrice === undefined || minPrice <= maxPrice
    );
  }

  defaultMessage() {
    return 'minPrice must be less than or equal to maxPrice';
  }
}

/**
 * GET /api/hotels?city=delhi[&minPrice=..][&maxPrice=..]
 *
 * class-validator runs decorators bottom-up, so the most basic check sits
 * closest to each property (with stopAtFirstError it reports that one first).
 */
export class HotelsQueryDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeCity(value) : value,
  )
  @Matches(/^[a-z][a-z .'-]{0,63}$/, { message: 'city is invalid' })
  @IsNotEmpty({ message: 'city is required' })
  @IsString({ message: 'city is required' })
  city!: string;

  @IsOptional()
  @Transform(toOptionalNumber)
  @Min(0, { message: 'minPrice must be a non-negative number' })
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: 'minPrice must be a non-negative number' },
  )
  minPrice?: number;

  @IsOptional()
  @Transform(toOptionalNumber)
  @Validate(MinPriceLteMaxPrice)
  @Min(0, { message: 'maxPrice must be a non-negative number' })
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: 'maxPrice must be a non-negative number' },
  )
  maxPrice?: number;
}
