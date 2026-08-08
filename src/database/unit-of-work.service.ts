import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UnitOfWorkService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Executes all operations inside a single Prisma transaction.
   * Any exception rolls back every write made within the callback.
   *
   * @example
   * await this.uow.execute(async (tx) => {
   *   await tx.lease.create({ data: ... });
   *   await tx.property.update({ where: { id }, data: { status: 'Rented' } });
   *   await tx.payment.create({ data: ... });
   * });
   */
  execute<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    isolationLevel?: Prisma.TransactionIsolationLevel,
  ): Promise<T> {
    return this.prisma.$transaction(
      fn,
      isolationLevel ? { isolationLevel } : undefined,
    );
  }
}
