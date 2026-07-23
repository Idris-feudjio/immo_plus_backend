import { Test } from '@nestjs/testing';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';

const MOCK_USER = {
  id: 'user-owner-1',
  role: 'OWNER' as const,
  email: 'o@test.com',
};

const makeFile = (mimetype: string, size = 100): Express.Multer.File => ({
  buffer: Buffer.alloc(size),
  mimetype,
  fieldname: 'photos[]',
  originalname: 'photo.jpg',
  encoding: '7bit',
  size,
  stream: null as any,
  destination: '',
  filename: '',
  path: '',
});

describe('MaintenanceController — addPhotos()', () => {
  let controller: MaintenanceController;
  let service: { addPhotos: jest.Mock };

  beforeEach(async () => {
    service = {
      addPhotos: jest.fn().mockResolvedValue({
        images: ['https://r2/maintenance/maint-1/photos/photo-1.jpg'],
      }),
    };

    const module = await Test.createTestingModule({
      controllers: [MaintenanceController],
      providers: [{ provide: MaintenanceService, useValue: service }],
    }).compile();

    controller = module.get(MaintenanceController);
  });

  it('délègue à MaintenanceService.addPhotos avec id, user et files, et retourne son résultat', async () => {
    const files = [makeFile('image/jpeg')];

    const result = await controller.addPhotos(
      'maint-1',
      MOCK_USER as any,
      files,
    );

    expect(service.addPhotos).toHaveBeenCalledWith(MOCK_USER, 'maint-1', files);
    expect(result).toEqual({
      images: ['https://r2/maintenance/maint-1/photos/photo-1.jpg'],
    });
  });
});
