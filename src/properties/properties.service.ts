import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePropertyDto, FilterPropertiesDto, UpdatePropertyDto } from './dto/create-property.dto';
import { buildPaginationMeta } from '../common/dto/pagination.dto';
import { PropertyStatus, Role } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function priceLabel(price: number): string {
  return price.toLocaleString('fr-FR') + ' FCFA/mois';
}

const PROPERTY_LIST_SELECT = {
  id: true,
  slug: true,
  title: true,
  type: true,
  city: true,
  neighborhood: true,
  address: true,
  price: true,
  priceLabel: true,
  area: true,
  bedrooms: true,
  bathrooms: true,
  status: true,
  isPublished: true,
  createdAt: true,
  images: {
    where: { isCover: true },
    take: 1,
    select: { url: true, thumbUrl: true },
  },
};

@Injectable()
export class PropertiesService {
  constructor(private prisma: PrismaService) {}

  async listPublic(query: FilterPropertiesDto) {
    return this.buildList({ ...query, isPublished: true });
  }

  async listDashboard(userId: string, role: string, query: FilterPropertiesDto) {
    const ownerWhere = role === Role.admin ? {} : role === Role.manager
      ? { managerId: userId }
      : { ownerId: userId };

    return this.buildList({ ...query, deletedAt: null }, ownerWhere);
  }

  async getBySlug(slug: string) {
    const property = await this.prisma.property.findFirst({
      where: { slug, isPublished: true, deletedAt: null },
      include: {
        images: { orderBy: { order: 'asc' } },
        documents: true,
      },
    });
    if (!property) throw new NotFoundException('Bien introuvable.');
    return property;
  }

  async getById(id: string) {
    const property = await this.prisma.property.findFirst({
      where: { id, deletedAt: null },
      include: { images: { orderBy: { order: 'asc' } }, documents: true },
    });
    if (!property) throw new NotFoundException('Bien introuvable.');
    return property;
  }

  async create(ownerId: string, dto: CreatePropertyDto) {
    const base = slugify(dto.title);
    const slug = `${base}-${uuidv4().substring(0, 8)}`;

    return this.prisma.property.create({
      data: {
        ...dto,
        slug,
        priceLabel: priceLabel(dto.price),
        ownerId,
      },
    });
  }

  async update(id: string, userId: string, role: string, dto: UpdatePropertyDto) {
    await this.checkOwnership(id, userId, role);
    const data: any = { ...dto };
    if (dto.price !== undefined) data.priceLabel = priceLabel(dto.price);
    return this.prisma.property.update({ where: { id }, data });
  }

  async setPublished(id: string, userId: string, role: string, isPublished: boolean) {
    const property = await this.checkOwnership(id, userId, role);

    if (isPublished) {
      const imageCount = await this.prisma.propertyImage.count({ where: { propertyId: id } });
      if (imageCount === 0) {
        throw new ConflictException('Le bien doit avoir au moins 1 image pour être publié.');
      }
    }

    return this.prisma.property.update({ where: { id }, data: { isPublished } });
  }

  async setStatus(id: string, userId: string, role: string, status: PropertyStatus) {
    if (status === PropertyStatus.Rented && role !== Role.admin) {
      throw new ForbiddenException('Le statut Rented est géré automatiquement.');
    }
    await this.checkOwnership(id, userId, role);
    return this.prisma.property.update({ where: { id }, data: { status } });
  }

  async remove(id: string, userId: string, role: string) {
    await this.checkOwnership(id, userId, role);

    const activeContract = await this.prisma.contract.findFirst({
      where: { propertyId: id, status: 'Active' },
    });
    if (activeContract) {
      throw new ConflictException({ error: 'PROPERTY_HAS_ACTIVE_CONTRACT', message: 'Impossible de supprimer un bien avec un contrat actif.' });
    }

    await this.prisma.property.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async addImages(id: string, userId: string, role: string, images: { url: string; thumbUrl: string }[]) {
    await this.checkOwnership(id, userId, role);

    const currentCount = await this.prisma.propertyImage.count({ where: { propertyId: id } });
    if (currentCount + images.length > 4) {
      throw new ConflictException({ error: 'MAX_IMAGES_REACHED', message: 'Maximum 4 images par bien.' });
    }

    const lastOrder = currentCount;
    const hasCover = await this.prisma.propertyImage.findFirst({ where: { propertyId: id, isCover: true } });

    const created = await Promise.all(
      images.map((img, idx) =>
        this.prisma.propertyImage.create({
          data: {
            propertyId: id,
            url: img.url,
            thumbUrl: img.thumbUrl,
            isCover: !hasCover && idx === 0,
            order: lastOrder + idx,
          },
        }),
      ),
    );

    return { images: created };
  }

  async setCover(propertyId: string, imageId: string, userId: string, role: string) {
    await this.checkOwnership(propertyId, userId, role);
    await this.prisma.propertyImage.updateMany({ where: { propertyId }, data: { isCover: false } });
    return this.prisma.propertyImage.update({ where: { id: imageId }, data: { isCover: true } });
  }

  async removeImage(propertyId: string, imageId: string, userId: string, role: string) {
    await this.checkOwnership(propertyId, userId, role);
    const img = await this.prisma.propertyImage.findFirst({ where: { id: imageId, propertyId } });
    if (!img) throw new NotFoundException('Image introuvable.');

    await this.prisma.propertyImage.delete({ where: { id: imageId } });

    if (img.isCover) {
      const next = await this.prisma.propertyImage.findFirst({ where: { propertyId }, orderBy: { order: 'asc' } });
      if (next) await this.prisma.propertyImage.update({ where: { id: next.id }, data: { isCover: true } });
    }
  }

  async addDocuments(propertyId: string, userId: string, role: string, docs: { name: string; url: string }[]) {
    await this.checkOwnership(propertyId, userId, role);
    const created = await Promise.all(
      docs.map((doc) =>
        this.prisma.propertyDocument.create({ data: { propertyId, name: doc.name, url: doc.url } }),
      ),
    );
    return { documents: created };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async checkOwnership(id: string, userId: string, role: string) {
    const property = await this.prisma.property.findFirst({ where: { id, deletedAt: null } });
    if (!property) throw new NotFoundException('Bien introuvable.');

    if (role === Role.admin) return property;
    if (role === Role.owner && property.ownerId !== userId) throw new ForbiddenException({ error: 'INSUFFICIENT_PERMISSIONS', message: 'Droits insuffisants.' });
    if (role === Role.manager && property.managerId !== userId) throw new ForbiddenException({ error: 'INSUFFICIENT_PERMISSIONS', message: 'Droits insuffisants.' });

    return property;
  }

  private async buildList(query: FilterPropertiesDto & { deletedAt?: null }, extraWhere: any = {}) {
    const { page = 1, limit = 20, sort, isPublished, ...filters } = query;
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null, ...extraWhere };

    if (isPublished !== undefined) where.isPublished = isPublished === true || isPublished === ('true' as any);
    if (filters.city) where.city = { contains: filters.city, mode: 'insensitive' };
    if (filters.neighborhood) where.neighborhood = { contains: filters.neighborhood, mode: 'insensitive' };
    if (filters.type) where.type = filters.type;
    if (filters.status) where.status = filters.status;
    if (filters.bedrooms) where.bedrooms = filters.bedrooms;
    if (filters.minPrice || filters.maxPrice) where.price = { gte: filters.minPrice, lte: filters.maxPrice };
    if (filters.minArea || filters.maxArea) where.area = { gte: filters.minArea, lte: filters.maxArea };
    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
        { address: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    let orderBy: any = { createdAt: 'desc' };
    if (sort === 'price') orderBy = { price: 'asc' };
    if (sort === '-price') orderBy = { price: 'desc' };
    if (sort === 'createdAt') orderBy = { createdAt: 'asc' };

    const [data, total] = await Promise.all([
      this.prisma.property.findMany({ where, skip, take: limit, select: PROPERTY_LIST_SELECT as any, orderBy }),
      this.prisma.property.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }
}
