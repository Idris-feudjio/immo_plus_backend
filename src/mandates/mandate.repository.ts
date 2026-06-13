import { Injectable } from '@nestjs/common';
import { MandateStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MandateRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActiveByManager(
    managerId: string,
    propertyId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.mandate.findFirst({
      where: {
        managerId,
        propertyId,
        status: MandateStatus.ACTIVE,
        deletedAt: null,
      },
      select: { id: true },
    });
  }
}
