import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { createValidationPipe } from '../src/common/validation';
import { HotelsController } from '../src/hotels/hotels.controller';
import { HotelsService } from '../src/hotels/hotels.service';

describe('GET /api/hotels validation (e2e)', () => {
  let app: INestApplication<App>;
  const findHotels = jest.fn();

  beforeEach(async () => {
    findHotels
      .mockReset()
      .mockResolvedValue({ hotels: [], failedSuppliers: [] });
    const moduleRef = await Test.createTestingModule({
      controllers: [HotelsController],
      providers: [{ provide: HotelsService, useValue: { findHotels } }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
  });

  afterEach(() => app.close());

  it('passes a normalized, typed query to the service', async () => {
    await request(app.getHttpServer())
      .get('/api/hotels?city=Delhi&minPrice=5000&maxPrice=10000&junk=1')
      .expect(200, []);

    const [query] = findHotels.mock.calls[0] as [Record<string, unknown>];
    expect(query).toEqual({ city: 'delhi', minPrice: 5000, maxPrice: 10000 });
  });

  it.each([
    ['/api/hotels', 'city is required'],
    [
      '/api/hotels?city=delhi&minPrice=cheap',
      'minPrice must be a non-negative number',
    ],
    [
      '/api/hotels?city=delhi&minPrice=9000&maxPrice=100',
      'minPrice must be less than or equal to maxPrice',
    ],
  ])('GET %s -> 400', async (url, message) => {
    const res = await request(app.getHttpServer()).get(url).expect(400);
    expect(res.body).toMatchObject({ message: [message], statusCode: 400 });
    expect(findHotels).not.toHaveBeenCalled();
  });
});
