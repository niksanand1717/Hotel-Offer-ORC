import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { createValidationPipe } from '../src/common/validation';
import { SuppliersModule } from '../src/suppliers/suppliers.module';

describe('Mock suppliers (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SuppliersModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
  });

  afterEach(() => app.close());

  it('GET /supplierA/hotels?city=delhi returns only Delhi hotels', async () => {
    const res = await request(app.getHttpServer())
      .get('/supplierA/hotels?city=Delhi')
      .expect(200);
    const hotels = res.body as { city: string }[];
    expect(hotels.length).toBeGreaterThan(0);
    expect(hotels.every((h) => h.city === 'delhi')).toBe(true);
  });

  it('GET /supplierB/hotels?city=paris returns an empty list', () =>
    request(app.getHttpServer())
      .get('/supplierB/hotels?city=paris')
      .expect(200, []));

  it('returns 503 while a supplier is marked down', async () => {
    const server = app.getHttpServer();
    await request(server)
      .put('/admin/suppliers/A')
      .send({ available: false })
      .expect(200);
    await request(server).get('/supplierA/hotels').expect(503);
    await request(server).get('/supplierB/hotels').expect(200);
  });

  it('rejects unknown suppliers and invalid bodies', async () => {
    const server = app.getHttpServer();
    await request(server)
      .put('/admin/suppliers/C')
      .send({ available: false })
      .expect(404);
    const res = await request(server)
      .put('/admin/suppliers/A')
      .send({ available: 'no' })
      .expect(400);
    expect(res.body).toMatchObject({
      message: ['available must be true or false'],
    });
  });
});
