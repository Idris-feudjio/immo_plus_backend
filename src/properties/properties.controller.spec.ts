import { Test } from '@nestjs/testing';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { CacheService } from '../cache/cache.service';

const MOCK_USER = { id: 'user-owner-1', role: 'OWNER' as const, email: 'o@test.com' };

describe('PropertiesController — create()', () => {
  let controller: PropertiesController;
  let service: { createProperty: jest.Mock };

  beforeEach(async () => {
    service = { createProperty: jest.fn().mockResolvedValue({ id: 'prop-1', slug: 'villa-abc12345' }) };

    const module = await Test.createTestingModule({
      controllers: [PropertiesController],
      providers: [
        { provide: PropertiesService, useValue: service },
        { provide: CacheService, useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn(), incr: jest.fn() } },
      ],
    }).compile();

    controller = module.get(PropertiesController);
  });

  it('délègue la création à PropertiesService.createProperty avec ownerId + dto', async () => {
    const dto = { title: 'Villa Test', type: 'VILLA', city: 'Yaoundé', neighborhood: 'Bastos', address: '1 Rue Test', price: 250000, area: 120 } as any;

    const result = await controller.create(MOCK_USER as any, dto);

    expect(service.createProperty).toHaveBeenCalledWith(MOCK_USER.id, dto);
    expect(result).toEqual({ id: 'prop-1', slug: 'villa-abc12345' });
  });
});
