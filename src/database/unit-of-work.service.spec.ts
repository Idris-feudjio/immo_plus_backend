import { Prisma } from '@prisma/client';
import { UnitOfWorkService } from './unit-of-work.service';

function mockPrisma() {
  return { $transaction: jest.fn().mockResolvedValue('result') };
}

describe('UnitOfWorkService', () => {
  it('calls $transaction without an options object when no isolation level is given', async () => {
    const prisma = mockPrisma();
    const uow = new UnitOfWorkService(prisma as never);
    const fn = jest.fn().mockResolvedValue('ok');

    const result = await uow.execute(fn);

    expect(prisma.$transaction).toHaveBeenCalledWith(fn, undefined);
    expect(result).toBe('result');
  });

  it('passes the isolation level through to $transaction when given', async () => {
    const prisma = mockPrisma();
    const uow = new UnitOfWorkService(prisma as never);
    const fn = jest.fn().mockResolvedValue('ok');

    await uow.execute(fn, Prisma.TransactionIsolationLevel.Serializable);

    expect(prisma.$transaction).toHaveBeenCalledWith(fn, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });
});
