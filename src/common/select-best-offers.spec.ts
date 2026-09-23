import { selectBestOffers } from './select-best-offers';
import type { SupplierHotel } from './types';

const hotel = (
  name: string,
  price: number,
  commissionPct = 10,
): SupplierHotel => ({
  hotelId: name,
  name,
  price,
  city: 'delhi',
  commissionPct,
});

describe('selectBestOffers', () => {
  it('keeps the cheaper offer for hotels present at both suppliers', () => {
    const result = selectBestOffers([
      {
        supplier: 'Supplier A',
        hotels: [hotel('Holtin', 6000), hotel('Radison', 5900, 13)],
      },
      {
        supplier: 'Supplier B',
        hotels: [hotel('Holtin', 5340, 20), hotel('Radison', 6100)],
      },
    ]);

    expect(result).toEqual([
      {
        name: 'Holtin',
        price: 5340,
        supplier: 'Supplier B',
        commissionPct: 20,
      },
      {
        name: 'Radison',
        price: 5900,
        supplier: 'Supplier A',
        commissionPct: 13,
      },
    ]);
  });

  it('keeps hotels offered by only one supplier', () => {
    const result = selectBestOffers([
      { supplier: 'Supplier A', hotels: [hotel('Only A', 100)] },
      { supplier: 'Supplier B', hotels: [hotel('Only B', 200)] },
    ]);

    expect(result.map((h) => [h.name, h.supplier])).toEqual([
      ['Only A', 'Supplier A'],
      ['Only B', 'Supplier B'],
    ]);
  });

  it('matches names case- and whitespace-insensitively', () => {
    const result = selectBestOffers([
      { supplier: 'Supplier A', hotels: [hotel('Holtin', 500)] },
      { supplier: 'Supplier B', hotels: [hotel('  holtin ', 400)] },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: 'holtin',
      price: 400,
      supplier: 'Supplier B',
    });
  });

  it('breaks price ties by higher commission, independent of input order', () => {
    const a = { supplier: 'Supplier A', hotels: [hotel('Tie', 300, 8)] };
    const b = { supplier: 'Supplier B', hotels: [hotel('Tie', 300, 11)] };

    expect(selectBestOffers([a, b])[0].supplier).toBe('Supplier B');
    expect(selectBestOffers([b, a])[0].supplier).toBe('Supplier B');
  });

  it('returns an empty list when no supplier has hotels', () => {
    expect(
      selectBestOffers([
        { supplier: 'Supplier A', hotels: [] },
        { supplier: 'Supplier B', hotels: [] },
      ]),
    ).toEqual([]);
  });
});
