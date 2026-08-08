import { PlanLimitService } from './plan-limit.service';

function fullMockPrisma() {
  return {
    agencyMember: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    subscription: { findUnique: jest.fn().mockResolvedValue(null) },
    property: { count: jest.fn().mockResolvedValue(0) },
  };
}

const PROFESSIONAL_PLAN = {
  id: 'plan-pro',
  maxProperties: 30,
  maxUsers: 10,
  maxPdfPerMonth: 500,
};
const ENTERPRISE_PLAN = {
  id: 'plan-ent',
  maxProperties: null,
  maxUsers: null,
  maxPdfPerMonth: null,
};

describe('PlanLimitService — resolveSubscriptionContext', () => {
  let prisma: ReturnType<typeof fullMockPrisma>;
  let service: PlanLimitService;

  beforeEach(() => {
    prisma = fullMockPrisma();
    service = new PlanLimitService(prisma as never);
  });

  it('resolves the agency subscription when the user has an agencyMembership', async () => {
    prisma.agencyMember.findUnique.mockResolvedValue({ agencyId: 'agency-1' });
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      agencyId: 'agency-1',
      ownerId: null,
      planId: 'plan-pro',
      plan: PROFESSIONAL_PLAN,
    });

    const ctx = await service.resolveSubscriptionContext('user-1');

    expect(prisma.subscription.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { agencyId: 'agency-1' } }),
    );
    expect(ctx).toEqual({
      subscriptionId: 'sub-1',
      planId: 'plan-pro',
      agencyId: 'agency-1',
      ownerId: null,
      limits: { maxProperties: 30, maxUsers: 10, maxPdfPerMonth: 500 },
    });
  });

  it('resolves the owner subscription when the user has no agencyMembership', async () => {
    prisma.agencyMember.findUnique.mockResolvedValue(null);
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-2',
      agencyId: null,
      ownerId: 'user-1',
      planId: 'plan-pro',
      plan: PROFESSIONAL_PLAN,
    });

    const ctx = await service.resolveSubscriptionContext('user-1');

    expect(prisma.subscription.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: 'user-1' } }),
    );
    expect(ctx?.ownerId).toBe('user-1');
  });

  it('returns null when no Subscription exists for the user', async () => {
    prisma.agencyMember.findUnique.mockResolvedValue(null);
    prisma.subscription.findUnique.mockResolvedValue(null);

    const ctx = await service.resolveSubscriptionContext('user-1');

    expect(ctx).toBeNull();
  });
});

describe('PlanLimitService — checkLimit', () => {
  let prisma: ReturnType<typeof fullMockPrisma>;
  let service: PlanLimitService;

  beforeEach(() => {
    prisma = fullMockPrisma();
    service = new PlanLimitService(prisma as never);
  });

  function mockOwnerContext(
    plan: {
      id: string;
      maxProperties: number | null;
      maxUsers: number | null;
      maxPdfPerMonth: number | null;
    } = PROFESSIONAL_PLAN,
  ) {
    prisma.agencyMember.findUnique.mockResolvedValue(null);
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      agencyId: null,
      ownerId: 'owner-1',
      planId: plan.id,
      plan,
    });
  }

  it('allows a standalone owner under the plan limit', async () => {
    mockOwnerContext();
    prisma.property.count.mockResolvedValue(29);

    const result = await service.checkLimit('owner-1', 'properties');

    expect(result).toEqual({ allowed: true, limit: 30, current: 29 });
  });

  it('refuses a standalone owner exactly at the limit for one more property', async () => {
    mockOwnerContext();
    prisma.property.count.mockResolvedValue(30);

    const result = await service.checkLimit('owner-1', 'properties');

    expect(result).toEqual({ allowed: false, limit: 30, current: 30 });
  });

  it('counts properties cumulatively across all agency members (owner + managers)', async () => {
    prisma.agencyMember.findUnique.mockResolvedValue({ agencyId: 'agency-1' });
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-agency',
      agencyId: 'agency-1',
      ownerId: null,
      planId: PROFESSIONAL_PLAN.id,
      plan: PROFESSIONAL_PLAN,
    });
    prisma.agencyMember.findMany.mockResolvedValue([
      { userId: 'member-1' },
      { userId: 'member-2' },
    ]);
    prisma.property.count.mockResolvedValue(12);

    const result = await service.checkLimit('member-1', 'properties');

    expect(prisma.property.count).toHaveBeenCalledWith({
      where: {
        OR: [
          { ownerId: { in: ['member-1', 'member-2'] } },
          { managerId: { in: ['member-1', 'member-2'] } },
        ],
      },
    });
    expect(result).toEqual({ allowed: true, limit: 30, current: 12 });
  });

  it('always allows when the plan limit is null (Enterprise), regardless of current usage', async () => {
    mockOwnerContext(ENTERPRISE_PLAN);
    prisma.property.count.mockResolvedValue(9999);

    const result = await service.checkLimit('owner-1', 'properties');

    expect(result).toEqual({ allowed: true, limit: null, current: 9999 });
  });

  it('fails open (allowed: true) when the user has no Subscription at all', async () => {
    prisma.agencyMember.findUnique.mockResolvedValue(null);
    prisma.subscription.findUnique.mockResolvedValue(null);

    const result = await service.checkLimit('legacy-user', 'properties');

    expect(result).toEqual({ allowed: true, limit: null, current: 0 });
  });

  it('counts a standalone owner as 1 user', async () => {
    mockOwnerContext();

    const result = await service.checkLimit('owner-1', 'users');

    expect(result).toEqual({ allowed: true, limit: 10, current: 1 });
  });

  it('returns a stub allowed:true result for the pdf resource', async () => {
    mockOwnerContext();

    const result = await service.checkLimit('owner-1', 'pdf');

    expect(result).toEqual({ allowed: true, limit: 500, current: 0 });
  });
});
