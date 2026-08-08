import { PlansService } from './plans.service';

function mockPrisma() {
  return {
    agencyMember: { findUnique: jest.fn().mockResolvedValue(null) },
    subscription: { findUnique: jest.fn().mockResolvedValue(null) },
  };
}

describe('PlansService — getMySubscriptionSummary', () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let service: PlansService;

  beforeEach(() => {
    prisma = mockPrisma();
    service = new PlansService(prisma as never);
  });

  it('returns null when the user has no Subscription (pre-story account)', async () => {
    const result = await service.getMySubscriptionSummary('legacy-user');

    expect(result).toBeNull();
  });

  it('returns trialDaysRemaining when status is TRIAL', async () => {
    // +1h safety margin so differenceInDays doesn't truncate to 4 due to the
    // few ms of real time that elapse between this line and the call below.
    const endsAt = new Date(
      Date.now() + 5 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000,
    );
    prisma.subscription.findUnique.mockResolvedValue({
      status: 'TRIAL',
      plan: { name: 'PROFESSIONAL' },
      trial: { endsAt },
    });

    const result = await service.getMySubscriptionSummary('owner-1');

    expect(result).toEqual({
      status: 'TRIAL',
      planName: 'PROFESSIONAL',
      trialDaysRemaining: 5,
    });
  });

  it('returns trialDaysRemaining: null when status is not TRIAL', async () => {
    prisma.subscription.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      plan: { name: 'PROFESSIONAL' },
      trial: null,
    });

    const result = await service.getMySubscriptionSummary('owner-1');

    expect(result).toEqual({
      status: 'ACTIVE',
      planName: 'PROFESSIONAL',
      trialDaysRemaining: null,
    });
  });

  it('clamps trialDaysRemaining to 0 rather than going negative', async () => {
    const endsAt = new Date(Date.now() - 1000);
    prisma.subscription.findUnique.mockResolvedValue({
      status: 'TRIAL',
      plan: { name: 'PROFESSIONAL' },
      trial: { endsAt },
    });

    const result = await service.getMySubscriptionSummary('owner-1');

    expect(result?.trialDaysRemaining).toBe(0);
  });

  it('resolves the agency Subscription when the user belongs to an agency', async () => {
    prisma.agencyMember.findUnique.mockResolvedValue({ agencyId: 'agency-1' });
    prisma.subscription.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      plan: { name: 'STARTER' },
      trial: null,
    });

    await service.getMySubscriptionSummary('member-1');

    expect(prisma.subscription.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { agencyId: 'agency-1' } }),
    );
  });
});
