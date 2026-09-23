import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { HotelsQueryDto } from './hotels-query.dto';

function validateQuery(query: Record<string, unknown>) {
  const dto = plainToInstance(HotelsQueryDto, query);
  const errors = validateSync(dto, { stopAtFirstError: true });
  return {
    dto,
    errors: errors.flatMap((e) => Object.values(e.constraints ?? {})),
  };
}

describe('HotelsQueryDto', () => {
  it('normalizes the city and converts prices to numbers', () => {
    const { dto, errors } = validateQuery({
      city: ' Delhi ',
      minPrice: '1000',
      maxPrice: '5000.5',
    });

    expect(errors).toEqual([]);
    expect(dto).toMatchObject({
      city: 'delhi',
      minPrice: 1000,
      maxPrice: 5000.5,
    });
  });

  it('treats missing or empty prices as unbounded', () => {
    const { dto, errors } = validateQuery({ city: 'delhi', minPrice: '' });

    expect(errors).toEqual([]);
    expect(dto.minPrice).toBeUndefined();
    expect(dto.maxPrice).toBeUndefined();
  });

  it.each([
    [{}, 'city is required'],
    [{ city: '  ' }, 'city is required'],
    [{ city: ['delhi', 'mumbai'] }, 'city is required'],
    [{ city: 'del*hi' }, 'city is invalid'],
    [
      { city: 'delhi', minPrice: 'abc' },
      'minPrice must be a non-negative number',
    ],
    [
      { city: 'delhi', maxPrice: '-1' },
      'maxPrice must be a non-negative number',
    ],
    [
      { city: 'delhi', minPrice: ['1', '2'] },
      'minPrice must be a non-negative number',
    ],
    [
      { city: 'delhi', minPrice: '500', maxPrice: '100' },
      'minPrice must be less than or equal to maxPrice',
    ],
  ])('rejects %j', (query, message) => {
    expect(validateQuery(query).errors).toEqual([message]);
  });
});
