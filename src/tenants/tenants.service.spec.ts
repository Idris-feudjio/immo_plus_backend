import { NotFoundException } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { TenantsService } from './tenants.service';

// ─── Mock factories ───────────────────────────────────────────────────────────

function mockRepository() {
  return {
    findByUserId: jest.fn(),
    findPaymentsForTenant: jest.fn().mockResolvedValue([]),
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT = { id: 'tenant-uuid-1', userId: 'user-1' };

const PAID_PAYMENT = {
  id: 'pay-1',
  status: PaymentStatus.PAID,
  amount: 150000,
  dueDate: new Date('2026-05-01'),
  period: 'mai 2026',
  receiptUrl: 'https://cdn.example.com/receipts/pay-1/receipt.pdf',
  paymentDate: new Date('2026-05-03'),
  paymentMethod: 'TRANSFER',
  property: { id: 'prop-1', title: 'Villa Bastos' },
};

const PENDING_PAYMENT = {
  id: 'pay-2',
  status: PaymentStatus.PENDING,
  amount: 150000,
  dueDate: new Date('2026-06-01'),
  period: 'juin 2026',
  receiptUrl: null,
  paymentDate: null,
  paymentMethod: null,
  property: { id: 'prop-1', title: 'Villa Bastos' },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TenantsService — getMyPayments', () => {
  let service: TenantsService;
  let repo: ReturnType<typeof mockRepository>;

  beforeEach(() => {
    repo = mockRepository();
    service = new TenantsService(repo as never);
  });

  it('returns paginated payments for authenticated tenant', async () => {
    repo.findByUserId.mockResolvedValue(TENANT);
    repo.findPaymentsForTenant.mockResolvedValue([
      PAID_PAYMENT,
      PENDING_PAYMENT,
    ]);

    const result = await service.getMyPayments('user-1');

    expect(result.data).toHaveLength(2);
    expect(repo.findPaymentsForTenant).toHaveBeenCalledWith('tenant-uuid-1');
  });

  it('throws 404 when no tenant record exists for userId', async () => {
    repo.findByUserId.mockResolvedValue(null);

    await expect(service.getMyPayments('user-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns empty data array when tenant has no active contract payments', async () => {
    repo.findByUserId.mockResolvedValue(TENANT);
    repo.findPaymentsForTenant.mockResolvedValue([]);

    const result = await service.getMyPayments('user-1');

    expect(result.data).toEqual([]);
  });

  it('PAID payments include receiptUrl in response', async () => {
    repo.findByUserId.mockResolvedValue(TENANT);
    repo.findPaymentsForTenant.mockResolvedValue([PAID_PAYMENT]);

    const result = await service.getMyPayments('user-1');

    const paid = result.data[0] as typeof PAID_PAYMENT;
    expect(paid.receiptUrl).toBe(PAID_PAYMENT.receiptUrl);
  });

  it('PENDING payments have null receiptUrl', async () => {
    repo.findByUserId.mockResolvedValue(TENANT);
    repo.findPaymentsForTenant.mockResolvedValue([PENDING_PAYMENT]);

    const result = await service.getMyPayments('user-1');

    const pending = result.data[0] as typeof PENDING_PAYMENT;
    expect(pending.receiptUrl).toBeNull();
    expect(pending.dueDate).toEqual(PENDING_PAYMENT.dueDate);
    expect(pending.amount).toBe(150000);
  });

  it('looks up tenant by the authenticated userId', async () => {
    repo.findByUserId.mockResolvedValue(TENANT);
    repo.findPaymentsForTenant.mockResolvedValue([]);

    await service.getMyPayments('user-42');

    expect(repo.findByUserId).toHaveBeenCalledWith('user-42');
  });
});
