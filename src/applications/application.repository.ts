import { Injectable } from '@nestjs/common';
import { Application, Gender } from '@prisma/client';
import {
  BaseRepository,
  PrismaModelDelegate,
} from '../common/abstractions/base.repository';
import type { QueryField } from '../common/interfaces/search-request.interface';
import { PrismaService } from '../prisma/prisma.service';

export type ApplicationCreateData = {
  propertyId: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  gender: Gender;
  nationalIdNumber: string;
  income?: number;
};

const APPLICATION_QUERY_FIELDS: QueryField[] = [
  {
    filterKey: 'status',
    prismaField: 'status',
    filterable: true,
    filterType: 'exact',
  },
  {
    filterKey: 'propertyId',
    prismaField: 'propertyId',
    filterable: true,
    filterType: 'exact',
  },
  { filterKey: 'createdAt', prismaField: 'createdAt', sortable: true },
];

@Injectable()
export class ApplicationRepository extends BaseRepository<
  Application,
  ApplicationCreateData
> {
  constructor(private readonly prisma: PrismaService) {
    super(
      prisma.application as unknown as PrismaModelDelegate<Application>,
      APPLICATION_QUERY_FIELDS,
    );
  }

  /** "Mon Espace" — candidatures de l'utilisateur connecté, bien ciblé + statut. */
  findByUser(userId: string) {
    return this.prisma.application.findMany({
      where: { userId },
      select: {
        id: true,
        status: true,
        createdAt: true,
        property: { select: { id: true, title: true, slug: true, city: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
