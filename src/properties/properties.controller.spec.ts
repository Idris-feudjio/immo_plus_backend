import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { CacheService } from '../cache/cache.service';
import { StorageService } from '../storage/storage.service';
import { MandateGuard } from '../common/guards/mandate.guard';

jest.mock('sharp', () => {
  return jest.fn(() => ({
    resize: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('thumb')),
  }));
});

const MOCK_USER = {
  id: 'user-owner-1',
  role: 'OWNER' as const,
  email: 'o@test.com',
};

const makeFile = (mimetype: string, size = 100): Express.Multer.File => ({
  buffer: Buffer.alloc(size),
  mimetype,
  fieldname: 'images[]',
  originalname: 'photo.jpg',
  encoding: '7bit',
  size,
  stream: null as any,
  destination: '',
  filename: '',
  path: '',
});

describe('PropertiesController — create()', () => {
  let controller: PropertiesController;
  let service: { createProperty: jest.Mock };

  beforeEach(async () => {
    service = {
      createProperty: jest
        .fn()
        .mockResolvedValue({ id: 'prop-1', slug: 'villa-abc12345' }),
    };

    const module = await Test.createTestingModule({
      controllers: [PropertiesController],
      providers: [
        { provide: PropertiesService, useValue: service },
        {
          provide: CacheService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
            incr: jest.fn(),
          },
        },
        { provide: StorageService, useValue: {} },
      ],
    })
      .overrideGuard(MandateGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get(PropertiesController);
  });

  it('délègue la création à PropertiesService.createProperty avec ownerId + dto', async () => {
    const dto = {
      title: 'Villa Test',
      type: 'VILLA',
      city: 'Yaoundé',
      neighborhood: 'Bastos',
      address: '1 Rue Test',
      price: 250000,
      area: 120,
    } as any;

    const result = await controller.create(MOCK_USER as any, dto);

    expect(service.createProperty).toHaveBeenCalledWith(MOCK_USER.id, dto);
    expect(result).toEqual({ id: 'prop-1', slug: 'villa-abc12345' });
  });
});

describe('PropertiesController — uploadImages()', () => {
  let controller: PropertiesController;
  let service: { addImages: jest.Mock; assertCanAddImages: jest.Mock };
  let storage: {
    uploadBuffer: jest.Mock;
    generateId: jest.Mock;
    generateKey: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      addImages: jest.fn().mockResolvedValue({ images: [] }),
      assertCanAddImages: jest.fn().mockResolvedValue(undefined),
    };
    storage = {
      uploadBuffer: jest.fn((key: string) =>
        Promise.resolve(`https://r2/${key}`),
      ),
      generateId: jest.fn().mockReturnValue('img-1'),
      generateKey: jest.fn((...parts: string[]) => parts.join('/')),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      controllers: [PropertiesController],
      providers: [
        { provide: PropertiesService, useValue: service },
        {
          provide: CacheService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
            incr: jest.fn(),
          },
        },
        { provide: StorageService, useValue: storage },
      ],
    })
      .overrideGuard(MandateGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get(PropertiesController);
  });

  // MIME-type and size validation for uploadImages() moved into FileValidationPipe
  // (Story 11.3) — pipes only execute in the real HTTP request lifecycle, never on a
  // direct method call like the tests in this file make, so those two cases are now
  // covered by src/common/pipes/file-validation.pipe.spec.ts instead.

  it("fichier valide → uploadBuffer appelé pour l'image et le thumbnail avec la bonne clé, puis délégué à addImages", async () => {
    await controller.uploadImages('prop-1', MOCK_USER as any, [
      makeFile('image/jpeg', 500),
    ]);

    expect(storage.uploadBuffer).toHaveBeenCalledWith(
      'properties/prop-1/images/img-1.jpg',
      expect.any(Buffer),
      'image/jpeg',
    );
    expect(storage.uploadBuffer).toHaveBeenCalledWith(
      'properties/prop-1/images/img-1-thumb.jpg',
      expect.any(Buffer),
      'image/jpeg',
    );
    expect(service.addImages).toHaveBeenCalledWith(
      'prop-1',
      MOCK_USER.id,
      MOCK_USER.role,
      [
        {
          id: 'img-1',
          url: 'https://r2/properties/prop-1/images/img-1.jpg',
          thumbUrl: 'https://r2/properties/prop-1/images/img-1-thumb.jpg',
        },
      ],
    );
  });

  it('ownership/quota rejetés → aucun upload R2 déclenché (vérifié AVANT tout traitement)', async () => {
    service.assertCanAddImages.mockRejectedValue(
      new Error('INSUFFICIENT_PERMISSIONS'),
    );

    await expect(
      controller.uploadImages('prop-1', MOCK_USER as any, [
        makeFile('image/jpeg', 500),
      ]),
    ).rejects.toThrow('INSUFFICIENT_PERMISSIONS');

    expect(service.assertCanAddImages).toHaveBeenCalledWith(
      'prop-1',
      MOCK_USER.id,
      MOCK_USER.role,
      1,
    );
    expect(storage.uploadBuffer).not.toHaveBeenCalled();
    expect(service.addImages).not.toHaveBeenCalled();
  });

  it('fichier corrompu (échec de décodage sharp) → BadRequestException INVALID_FILE_TYPE, nettoyage des fichiers déjà uploadés dans le même lot', async () => {
    storage.generateId
      .mockReturnValueOnce('img-ok')
      .mockReturnValueOnce('img-bad');
    const sharpMock = jest.requireMock('sharp');
    sharpMock
      .mockImplementationOnce(() => ({
        resize: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(Buffer.from('thumb')),
      }))
      .mockImplementationOnce(() => ({
        resize: jest.fn().mockReturnThis(),
        toBuffer: jest
          .fn()
          .mockRejectedValue(new Error('unsupported image format')),
      }));

    const err = await controller
      .uploadImages('prop-1', MOCK_USER as any, [
        makeFile('image/jpeg', 500),
        makeFile('image/jpeg', 500),
      ])
      .catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain('INVALID_FILE_TYPE');
    expect(storage.delete).toHaveBeenCalledWith(
      'properties/prop-1/images/img-ok.jpg',
    );
    expect(storage.delete).toHaveBeenCalledWith(
      'properties/prop-1/images/img-ok-thumb.jpg',
    );
    expect(service.addImages).not.toHaveBeenCalled();
  });
});

describe('PropertiesController — uploadDocuments()', () => {
  let controller: PropertiesController;
  let service: { addDocuments: jest.Mock };
  let storage: {
    uploadBuffer: jest.Mock;
    generateId: jest.Mock;
    generateKey: jest.Mock;
  };

  beforeEach(async () => {
    service = { addDocuments: jest.fn().mockResolvedValue({ documents: [] }) };
    storage = {
      uploadBuffer: jest.fn((key: string) =>
        Promise.resolve(`https://r2/${key}`),
      ),
      generateId: jest.fn().mockReturnValue('doc-1'),
      generateKey: jest.fn((...parts: string[]) => parts.join('/')),
    };

    const module = await Test.createTestingModule({
      controllers: [PropertiesController],
      providers: [
        { provide: PropertiesService, useValue: service },
        {
          provide: CacheService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
            incr: jest.fn(),
          },
        },
        { provide: StorageService, useValue: storage },
      ],
    })
      .overrideGuard(MandateGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get(PropertiesController);
  });

  it('fichier PDF valide → uploadBuffer appelé avec la bonne clé, URL réelle transmise à addDocuments (AC#6)', async () => {
    const file = makeFile('application/pdf', 500);

    await controller.uploadDocuments('prop-1', MOCK_USER as any, [file], {});

    expect(storage.uploadBuffer).toHaveBeenCalledWith(
      'properties/prop-1/documents/doc-1.pdf',
      file.buffer,
      'application/pdf',
    );
    expect(service.addDocuments).toHaveBeenCalledWith(
      'prop-1',
      MOCK_USER.id,
      MOCK_USER.role,
      [
        {
          name: 'photo.jpg',
          url: 'https://r2/properties/prop-1/documents/doc-1.pdf',
        },
      ],
    );
  });

  it("utilise le nom fourni dans body.names s'il existe, sinon l'originalname du fichier", async () => {
    const file = makeFile('application/pdf', 500);

    await controller.uploadDocuments('prop-1', MOCK_USER as any, [file], {
      names: ['Bail signé.pdf'],
    });

    expect(service.addDocuments).toHaveBeenCalledWith(
      'prop-1',
      MOCK_USER.id,
      MOCK_USER.role,
      [{ name: 'Bail signé.pdf', url: expect.any(String) }],
    );
  });
});

describe('PropertiesController — getForEdit()', () => {
  let controller: PropertiesController;
  let service: { getByIdForOwner: jest.Mock };

  beforeEach(async () => {
    service = {
      getByIdForOwner: jest
        .fn()
        .mockResolvedValue({ id: 'prop-1', title: 'Villa Test' }),
    };

    const module = await Test.createTestingModule({
      controllers: [PropertiesController],
      providers: [
        { provide: PropertiesService, useValue: service },
        {
          provide: CacheService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
            incr: jest.fn(),
          },
        },
        { provide: StorageService, useValue: {} },
      ],
    })
      .overrideGuard(MandateGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get(PropertiesController);
  });

  it('délègue à PropertiesService.getByIdForOwner avec userId + role', async () => {
    const result = await controller.getForEdit('prop-1', MOCK_USER as any);

    expect(service.getByIdForOwner).toHaveBeenCalledWith(
      'prop-1',
      MOCK_USER.id,
      MOCK_USER.role,
    );
    expect(result).toEqual({ id: 'prop-1', title: 'Villa Test' });
  });
});

describe('PropertiesController — MandateGuard wiring', () => {
  it('applique MandateGuard sur update(), setStatus() et getForEdit()', () => {
    for (const method of ['update', 'setStatus', 'getForEdit'] as const) {
      const guards =
        Reflect.getMetadata(
          GUARDS_METADATA,
          PropertiesController.prototype[method],
        ) ?? [];
      expect(guards).toContain(MandateGuard);
    }
  });

  it("n'applique PAS MandateGuard sur remove() (MANAGER n'a de toute façon pas ce rôle sur cette route)", () => {
    const guards =
      Reflect.getMetadata(
        GUARDS_METADATA,
        PropertiesController.prototype.remove,
      ) ?? [];
    expect(guards).not.toContain(MandateGuard);
  });
});
