import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Property, PropertyStatus, Role } from '@prisma/client';
import { PropertiesService } from './properties.service';
import { PropertyRepository } from './property.repository';

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

  beforeEach(() => {
    repo = mockRepo();
    service = new PropertiesService(repo);
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
    it('throws ConflictException when adding images would exceed 4', async () => {
      repo.findByIdActive.mockResolvedValue(baseProperty());
      repo.countImages.mockResolvedValue(3);

      await expect(
        service.addImages(PROP_ID, OWNER_ID, Role.OWNER, [
          { url: 'a.jpg', thumbUrl: 'a-t.jpg' },
          { url: 'b.jpg', thumbUrl: 'b-t.jpg' },
        ]),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('sets first uploaded image as cover when no cover exists', async () => {
      repo.findByIdActive.mockResolvedValue(baseProperty());
      repo.countImages.mockResolvedValue(0);
      repo.findFirstCoverImage.mockResolvedValue(null);
      repo.createImages.mockResolvedValue([
        { id: 'img-1', propertyId: PROP_ID, url: 'a.jpg', thumbUrl: null, isCover: true, order: 0, createdAt: new Date() },
      ]);

      await service.addImages(PROP_ID, OWNER_ID, Role.OWNER, [{ url: 'a.jpg', thumbUrl: 'a-t.jpg' }]);

      expect(repo.createImages).toHaveBeenCalledWith([
        expect.objectContaining({ isCover: true, order: 0 }),
      ]);
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
