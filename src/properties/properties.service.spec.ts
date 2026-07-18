import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Property, PropertyStatus, Role } from '@prisma/client';
import { PropertiesService } from './properties.service';
import { PropertyRepository } from './property.repository';
import { StorageService } from '../storage/storage.service';

// ─── Mock factory ─────────────────────────────────────────────────────────────

function mockRepo(): jest.Mocked<PropertyRepository> {
  return {
    findById: jest.fn(),
    findByIdActive: jest.fn(),
    findByIdWithDetails: jest.fn(),
    findBySlugPublic: jest.fn(),
    findListPaginated: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    softDelete: jest.fn(),
    hasActiveContract: jest.fn(),
    countImages: jest.fn(),
    findImageById: jest.fn(),
    findFirstCoverImage: jest.fn(),
    createImages: jest.fn(),
    setCoverImage: jest.fn(),
    deleteImageById: jest.fn(),
    findFirstImage: jest.fn(),
    setImageCover: jest.fn(),
    createDocuments: jest.fn(),
    findAll: jest.fn(),
    findWithPagination: jest.fn(),
    findByIdOrThrow: jest.fn(),
  } as unknown as jest.Mocked<PropertyRepository>;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const OWNER_ID = 'user-owner-1';
const PROP_ID = 'prop-1';

function baseProperty(overrides: Partial<Property> = {}): Property {
  return {
    id: PROP_ID,
    slug: 'villa-test-abc12345',
    title: 'Villa Test',
    type: 'VILLA' as Property['type'],
    city: 'Yaoundé',
    neighborhood: 'Bastos',
    address: '123 rue test',
    latitude: null,
    longitude: null,
    price: 250000,
    priceLabel: '250 000 FCFA/mois',
    area: 120 as unknown as Property['area'],
    bedrooms: 3,
    bathrooms: 2,
    floor: null,
    description: null,
    status: PropertyStatus.AVAILABLE,
    ownerId: OWNER_ID,
    managerId: null,
    isPublished: false,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PropertiesService', () => {
  let service: PropertiesService;
  let repo: jest.Mocked<PropertyRepository>;
  let storage: { delete: jest.Mock; keyFromUrl: jest.Mock; uploadBuffer: jest.Mock; generateId: jest.Mock; generateKey: jest.Mock };

  beforeEach(() => {
    repo = mockRepo();
    storage = {
      delete: jest.fn().mockResolvedValue(undefined),
      keyFromUrl: jest.fn((url: string) => url.replace('https://r2/', '')),
      uploadBuffer: jest.fn(),
      generateId: jest.fn(),
      generateKey: jest.fn(),
    };
    service = new PropertiesService(repo, storage as unknown as StorageService);
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('generates a slug and priceLabel, then delegates to repository.create', async () => {
      const dto = {
        title: 'Belle villa',
        type: 'VILLA' as Property['type'],
        city: 'Yaoundé',
        neighborhood: 'Bastos',
        address: '1 rue test',
        price: 300000,
        area: 150,
      };

      const created = baseProperty({ title: 'Belle villa', price: 300000 });
      repo.create.mockResolvedValue(created);

      const result = await service.createProperty(OWNER_ID, dto as never);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Belle villa',
          priceLabel: (300000).toLocaleString('fr-FR') + ' FCFA/mois',
          ownerId: OWNER_ID,
          slug: expect.stringMatching(/^belle-villa-[a-f0-9]{8}$/),
        }),
      );
      expect(result).toBe(created);
    });
  });

  // ── setPublished ───────────────────────────────────────────────────────────

  describe('setPublished', () => {
    it('throws ConflictException when publishing with no images', async () => {
      repo.findByIdActive.mockResolvedValue(baseProperty());
      repo.countImages.mockResolvedValue(0);

      await expect(
        service.setPublished(PROP_ID, OWNER_ID, Role.OWNER, true),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('publishes when images exist', async () => {
      repo.findByIdActive.mockResolvedValue(baseProperty());
      repo.countImages.mockResolvedValue(2);
      repo.update.mockResolvedValue(baseProperty({ isPublished: true }));

      const result = await service.setPublished(PROP_ID, OWNER_ID, Role.OWNER, true);

      expect(repo.update).toHaveBeenCalledWith(PROP_ID, { isPublished: true });
      expect(result.isPublished).toBe(true);
    });

    it('unpublishes without checking image count', async () => {
      repo.findByIdActive.mockResolvedValue(baseProperty({ isPublished: true }));
      repo.update.mockResolvedValue(baseProperty({ isPublished: false }));

      await service.setPublished(PROP_ID, OWNER_ID, Role.OWNER, false);

      expect(repo.countImages).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith(PROP_ID, { isPublished: false });
    });
  });

  // ── setStatus ──────────────────────────────────────────────────────────────

  describe('setStatus', () => {
    it('throws ForbiddenException when non-admin tries to set RENTED', async () => {
      await expect(
        service.setStatus(PROP_ID, OWNER_ID, Role.OWNER, PropertyStatus.RENTED),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows ADMIN to set RENTED', async () => {
      repo.findByIdActive.mockResolvedValue(baseProperty());
      repo.update.mockResolvedValue(baseProperty({ status: PropertyStatus.RENTED }));

      const result = await service.setStatus(PROP_ID, 'admin-id', Role.ADMIN, PropertyStatus.RENTED);

      expect(result.status).toBe(PropertyStatus.RENTED);
    });
  });

  // ── remove ─────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('throws ConflictException when property has an active contract', async () => {
      repo.findByIdActive.mockResolvedValue(baseProperty());
      repo.hasActiveContract.mockResolvedValue(true);

      await expect(
        service.remove(PROP_ID, OWNER_ID, Role.OWNER),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('soft deletes when no active contract', async () => {
      repo.findByIdActive.mockResolvedValue(baseProperty());
      repo.hasActiveContract.mockResolvedValue(false);
      repo.softDelete.mockResolvedValue(undefined);

      await service.remove(PROP_ID, OWNER_ID, Role.OWNER);

      expect(repo.softDelete).toHaveBeenCalledWith(PROP_ID);
    });
  });

  // ── addImages ──────────────────────────────────────────────────────────────

  describe('addImages', () => {
    it('throws ConflictException when adding images would exceed 20', async () => {
      repo.findByIdActive.mockResolvedValue(baseProperty());
      repo.countImages.mockResolvedValue(19);

      await expect(
        service.addImages(PROP_ID, OWNER_ID, Role.OWNER, [
          { id: 'img-a', url: 'a.jpg', thumbUrl: 'a-t.jpg' },
          { id: 'img-b', url: 'b.jpg', thumbUrl: 'b-t.jpg' },
        ]),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows adding images up to exactly 20', async () => {
      repo.findByIdActive.mockResolvedValue(baseProperty());
      repo.countImages.mockResolvedValue(19);
      repo.findFirstCoverImage.mockResolvedValue({ id: 'existing-cover' } as never);
      repo.createImages.mockResolvedValue([]);

      await service.addImages(PROP_ID, OWNER_ID, Role.OWNER, [{ id: 'img-a', url: 'a.jpg', thumbUrl: 'a-t.jpg' }]);

      expect(repo.createImages).toHaveBeenCalled();
    });

    it('sets first uploaded image as cover when no cover exists', async () => {
      repo.findByIdActive.mockResolvedValue(baseProperty());
      repo.countImages.mockResolvedValue(0);
      repo.findFirstCoverImage.mockResolvedValue(null);
      repo.createImages.mockResolvedValue([
        { id: 'img-1', propertyId: PROP_ID, url: 'a.jpg', thumbUrl: null, isCover: true, order: 0, createdAt: new Date() },
      ]);

      await service.addImages(PROP_ID, OWNER_ID, Role.OWNER, [{ id: 'img-1', url: 'a.jpg', thumbUrl: 'a-t.jpg' }]);

      expect(repo.createImages).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'img-1', isCover: true, order: 0 }),
      ]);
    });
  });

  // ── removeImage ────────────────────────────────────────────────────────────

  describe('removeImage', () => {
    it('deletes the DB row and both R2 objects (image + thumbnail)', async () => {
      repo.findByIdActive.mockResolvedValue(baseProperty());
      repo.findImageById.mockResolvedValue({
        id: 'img-1', propertyId: PROP_ID, url: 'https://r2/properties/prop-1/images/img-1.jpg',
        thumbUrl: 'https://r2/properties/prop-1/images/img-1-thumb.jpg', isCover: false, order: 0, createdAt: new Date(),
      });

      await service.removeImage(PROP_ID, 'img-1', OWNER_ID, Role.OWNER);

      expect(repo.deleteImageById).toHaveBeenCalledWith('img-1');
      expect(storage.delete).toHaveBeenCalledWith('properties/prop-1/images/img-1.jpg');
      expect(storage.delete).toHaveBeenCalledWith('properties/prop-1/images/img-1-thumb.jpg');
    });

    it('throws NotFoundException when image does not exist', async () => {
      repo.findByIdActive.mockResolvedValue(baseProperty());
      repo.findImageById.mockResolvedValue(null);

      await expect(
        service.removeImage(PROP_ID, 'missing-img', OWNER_ID, Role.OWNER),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('promotes the next image to cover when the deleted image was the cover', async () => {
      repo.findByIdActive.mockResolvedValue(baseProperty());
      repo.findImageById.mockResolvedValue({
        id: 'img-1', propertyId: PROP_ID, url: 'https://r2/a.jpg', thumbUrl: null, isCover: true, order: 0, createdAt: new Date(),
      });
      repo.findFirstImage.mockResolvedValue({
        id: 'img-2', propertyId: PROP_ID, url: 'https://r2/b.jpg', thumbUrl: null, isCover: false, order: 1, createdAt: new Date(),
      });

      await service.removeImage(PROP_ID, 'img-1', OWNER_ID, Role.OWNER);

      expect(repo.setImageCover).toHaveBeenCalledWith('img-2', true);
    });
  });

  // ── public address masking ─────────────────────────────────────────────────

  describe('public visibility (address masking)', () => {
    it('listPublic() masks address but keeps other fields', async () => {
      repo.findListPaginated.mockResolvedValue({
        data: [
          { id: PROP_ID, slug: 'villa-test-abc12345', title: 'Villa Test', type: 'VILLA', city: 'Yaoundé', neighborhood: 'Bastos', address: '123 rue test', price: 250000, priceLabel: '250 000 FCFA/mois', area: 120, bedrooms: 3, bathrooms: 2, status: PropertyStatus.AVAILABLE, isPublished: true, createdAt: new Date(), images: [] } as never,
        ],
        meta: { total: 1, pageNumber: 0, pageSize: 20, totalPages: 1 },
      });

      const result = await service.listPublic({});

      expect(result.data[0].address).toBe('');
      expect(result.data[0].city).toBe('Yaoundé');
      expect(result.data[0].neighborhood).toBe('Bastos');
      expect(repo.findListPaginated).toHaveBeenCalledWith(
        expect.anything(),
        { isPublished: true, status: PropertyStatus.AVAILABLE },
        true,
      );
    });

    it('listPublic() forces status=AVAILABLE and ignores a client-supplied status filter', async () => {
      repo.findListPaginated.mockResolvedValue({
        data: [],
        meta: { total: 0, pageNumber: 0, pageSize: 20, totalPages: 0 },
      });

      // A visitor crafting ?status=RENTED must not be able to see non-available
      // published properties on the public search.
      await service.listPublic({ status: PropertyStatus.RENTED } as never);

      const [searchRequest, extraWhere] = repo.findListPaginated.mock.calls[0];
      expect(extraWhere).toEqual({ isPublished: true, status: PropertyStatus.AVAILABLE });
      expect((searchRequest as { filters?: Record<string, unknown> }).filters?.status).toBeUndefined();
    });

    it('getBySlug() masks address but keeps latitude/longitude/city/neighborhood', async () => {
      repo.findBySlugPublic.mockResolvedValue({
        ...baseProperty({ address: '123 rue test', latitude: 3.848 as never, longitude: 11.502 as never, isPublished: true }),
        images: [],
        documents: [],
      });

      const result = await service.getBySlug('villa-test-abc12345');

      expect(result.address).toBe('');
      expect(result.latitude).toBe(3.848);
      expect(result.longitude).toBe(11.502);
      expect(result.city).toBe('Yaoundé');
      expect(result.neighborhood).toBe('Bastos');
    });

    it('listDashboard() does NOT mask address (authenticated route)', async () => {
      repo.findListPaginated.mockResolvedValue({
        data: [
          { id: PROP_ID, slug: 'villa-test-abc12345', title: 'Villa Test', type: 'VILLA', city: 'Yaoundé', neighborhood: 'Bastos', address: '123 rue test', price: 250000, priceLabel: '250 000 FCFA/mois', area: 120, bedrooms: 3, bathrooms: 2, status: PropertyStatus.AVAILABLE, isPublished: true, createdAt: new Date(), images: [] } as never,
        ],
        meta: { total: 1, pageNumber: 0, pageSize: 20, totalPages: 1 },
      });

      const result = await service.listDashboard(OWNER_ID, Role.OWNER, {});

      expect(result.data[0].address).toBe('123 rue test');
    });

    it('getById() does NOT mask address (authenticated route)', async () => {
      repo.findByIdWithDetails.mockResolvedValue({
        ...baseProperty({ address: '123 rue test' }),
        images: [],
        documents: [],
      });

      const result = await service.getById(PROP_ID);

      expect(result.address).toBe('123 rue test');
    });
  });

  // ── getByIdForOwner ────────────────────────────────────────────────────────

  describe('getByIdForOwner', () => {
    it('throws NotFoundException when property does not exist', async () => {
      repo.findByIdActive.mockResolvedValue(null);

      await expect(
        service.getByIdForOwner(PROP_ID, OWNER_ID, Role.OWNER),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("throws ForbiddenException when OWNER requests another owner's property", async () => {
      repo.findByIdActive.mockResolvedValue(baseProperty({ ownerId: 'other-owner' }));

      await expect(
        service.getByIdForOwner(PROP_ID, OWNER_ID, Role.OWNER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns full details (including address) when ownership check passes', async () => {
      repo.findByIdActive.mockResolvedValue(baseProperty());
      repo.findByIdWithDetails.mockResolvedValue({
        ...baseProperty({ address: '123 rue test' }),
        images: [],
        documents: [],
      });

      const result = await service.getByIdForOwner(PROP_ID, OWNER_ID, Role.OWNER);

      expect(result.address).toBe('123 rue test');
    });
  });

  // ── checkOwnership ─────────────────────────────────────────────────────────

  describe('ownership checks', () => {
    it('throws NotFoundException when property does not exist', async () => {
      repo.findByIdActive.mockResolvedValue(null);

      await expect(
        service.updateProperty(PROP_ID, OWNER_ID, Role.OWNER, {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ForbiddenException when OWNER tries to modify another owner\'s property', async () => {
      repo.findByIdActive.mockResolvedValue(baseProperty({ ownerId: 'other-owner' }));

      await expect(
        service.updateProperty(PROP_ID, OWNER_ID, Role.OWNER, {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows ADMIN to modify any property', async () => {
      repo.findByIdActive.mockResolvedValue(baseProperty({ ownerId: 'other-owner' }));
      repo.update.mockResolvedValue(baseProperty({ title: 'Updated' }));

      const result = await service.updateProperty(PROP_ID, 'admin-id', Role.ADMIN, { title: 'Updated' });

      expect(repo.update).toHaveBeenCalled();
      expect(result.title).toBe('Updated');
    });
  });
});
