import { CronService } from './cron.service';

// ─── Mock factories ───────────────────────────────────────────────────────────

function mockPrisma() {
  return {
    payment: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    contract: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    property: {
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    notification: {
      create: jest.fn().mockResolvedValue({}),
      createMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    paymentAlertConfig: { findMany: jest.fn().mockResolvedValue([]) },
    mandate: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    subscription: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

function mockEmailQueue() {
  return { sendEmail: jest.fn().mockResolvedValue(undefined) };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const OWNER = {
  id: 'owner-1',
  email: 'owner@test.cm',
  firstName: 'Marc',
  lastName: 'Dupont',
};

const BASE_CONFIG = {
  userId: 'owner-1',
  active: true,
  daysBeforeDue: 5,
  daysAfterDue: [1, 3, 7],
  user: OWNER,
};

const PENDING_PAYMENT = {
  tenantId: 'tenant-uuid-1',
  amount: 150000,
  period: 'janvier 2026',
  dueDate: new Date(),
  tenant: { firstName: 'Alice', lastName: 'Ngo' },
  property: { title: 'Villa Bastos' },
};

const LATE_PAYMENT = { ...PENDING_PAYMENT };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CronService — sendPaymentAlerts', () => {
  let service: CronService;
  let prisma: ReturnType<typeof mockPrisma>;
  let emailQueue: ReturnType<typeof mockEmailQueue>;

  beforeEach(() => {
    prisma = mockPrisma();
    emailQueue = mockEmailQueue();
    service = new CronService(prisma as never, emailQueue as never);
  });

  it('does nothing when no active PaymentAlertConfigs exist', async () => {
    prisma.paymentAlertConfig.findMany.mockResolvedValue([]);
    await service.sendPaymentAlerts();
    expect(emailQueue.sendEmail).not.toHaveBeenCalled();
  });

  it('queues pre-due alert email when PENDING payment due in daysBeforeDue days', async () => {
    prisma.paymentAlertConfig.findMany.mockResolvedValue([BASE_CONFIG]);
    prisma.payment.findMany
      .mockResolvedValueOnce([PENDING_PAYMENT]) // pre-due query
      .mockResolvedValue([]); // late queries return empty

    await service.sendPaymentAlerts();

    expect(emailQueue.sendEmail).toHaveBeenCalledTimes(1);
    expect(emailQueue.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'owner@test.cm',
        template: 'payment-alert-pre',
      }),
    );
  });

  it('queues late-alert email when LATE payment matches daysAfterDue', async () => {
    prisma.paymentAlertConfig.findMany.mockResolvedValue([BASE_CONFIG]);
    prisma.payment.findMany
      .mockResolvedValueOnce([]) // pre-due: nothing
      .mockResolvedValueOnce([LATE_PAYMENT]) // daysAfterDue[0] = 1 day late
      .mockResolvedValue([]); // rest empty

    await service.sendPaymentAlerts();

    expect(emailQueue.sendEmail).toHaveBeenCalledTimes(1);
    expect(emailQueue.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ template: 'payment-alert-late' }),
    );
  });

  it('creates a Notification record for each alert dispatched', async () => {
    prisma.paymentAlertConfig.findMany.mockResolvedValue([BASE_CONFIG]);
    prisma.payment.findMany
      .mockResolvedValueOnce([PENDING_PAYMENT])
      .mockResolvedValue([]);

    await service.sendPaymentAlerts();

    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'owner-1',
          type: 'payment_alert_pre',
          body: expect.stringContaining('tenant-uuid-1'),
        }),
      }),
    );
  });

  it('suppresses alert when tenant already has 3 notifications this month', async () => {
    prisma.paymentAlertConfig.findMany.mockResolvedValue([BASE_CONFIG]);
    prisma.payment.findMany
      .mockResolvedValueOnce([PENDING_PAYMENT])
      .mockResolvedValue([]);
    prisma.notification.count.mockResolvedValue(3);

    await service.sendPaymentAlerts();

    expect(emailQueue.sendEmail).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('sends alert when tenant has exactly 2 notifications this month (below cap)', async () => {
    prisma.paymentAlertConfig.findMany.mockResolvedValue([BASE_CONFIG]);
    prisma.payment.findMany
      .mockResolvedValueOnce([PENDING_PAYMENT])
      .mockResolvedValue([]);
    prisma.notification.count.mockResolvedValue(2);

    await service.sendPaymentAlerts();

    expect(emailQueue.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('skips owner when active = false — DB query with where:{active:true} returns nothing', async () => {
    // The CronService queries paymentAlertConfig with where: { active: true }
    // Inactive configs are filtered out at DB level, so this returns []
    prisma.paymentAlertConfig.findMany.mockResolvedValue([]);

    await service.sendPaymentAlerts();

    expect(prisma.payment.findMany).not.toHaveBeenCalled();
    expect(emailQueue.sendEmail).not.toHaveBeenCalled();
  });

  it('checks suppression using tenantId embedded in notification body', async () => {
    prisma.paymentAlertConfig.findMany.mockResolvedValue([BASE_CONFIG]);
    prisma.payment.findMany
      .mockResolvedValueOnce([PENDING_PAYMENT])
      .mockResolvedValue([]);

    await service.sendPaymentAlerts();

    expect(prisma.notification.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          body: { contains: 'tenant-uuid-1' },
        }),
      }),
    );
  });
});

// ─── sendLeaseExpiryAlerts — J-30 email ────────────────────────────────────────

describe('CronService — sendLeaseExpiryAlerts (J-30 email)', () => {
  let service: CronService;
  let prisma: ReturnType<typeof mockPrisma>;
  let emailQueue: ReturnType<typeof mockEmailQueue>;

  const OWNER = {
    id: 'owner-1',
    email: 'owner@test.cm',
    firstName: 'Marc',
    lastName: 'Dupont',
  };
  const MANAGER = {
    id: 'mgr-1',
    email: 'manager@test.cm',
    firstName: 'Alice',
    lastName: 'Ngo',
  };

  const CONTRACT_J30 = {
    id: 'c-1',
    endDate: new Date(),
    property: {
      title: 'Villa Bastos',
      ownerId: OWNER.id,
      owner: OWNER,
      manager: null as typeof MANAGER | null,
    },
  };

  beforeEach(() => {
    prisma = mockPrisma();
    emailQueue = mockEmailQueue();
    service = new CronService(prisma as never, emailQueue as never);
  });

  it('sends a J-30 email to the owner only when no manager is delegated', async () => {
    prisma.contract.findMany
      .mockResolvedValueOnce([]) // J-7
      .mockResolvedValueOnce([]) // J-15
      .mockResolvedValueOnce([CONTRACT_J30]); // J-30

    await service.sendLeaseExpiryAlerts();

    expect(emailQueue.sendEmail).toHaveBeenCalledTimes(1);
    expect(emailQueue.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: OWNER.email,
        template: 'lease-expiring-j30',
      }),
    );
  });

  it('sends a J-30 email to both owner and manager when a manager is delegated', async () => {
    prisma.contract.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          ...CONTRACT_J30,
          property: { ...CONTRACT_J30.property, manager: MANAGER },
        },
      ]);

    await service.sendLeaseExpiryAlerts();

    expect(emailQueue.sendEmail).toHaveBeenCalledTimes(2);
    expect(emailQueue.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: OWNER.email }),
    );
    expect(emailQueue.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: MANAGER.email }),
    );
  });

  it('does not send an email for J-7 or J-15 thresholds', async () => {
    prisma.contract.findMany
      .mockResolvedValueOnce([CONTRACT_J30]) // J-7
      .mockResolvedValueOnce([CONTRACT_J30]) // J-15
      .mockResolvedValueOnce([]); // J-30

    await service.sendLeaseExpiryAlerts();

    expect(emailQueue.sendEmail).not.toHaveBeenCalled();
  });
});

// ─── expireTrials ───────────────────────────────────────────────────────────

describe('CronService — expireTrials', () => {
  let service: CronService;
  let prisma: ReturnType<typeof mockPrisma>;
  let emailQueue: ReturnType<typeof mockEmailQueue>;

  beforeEach(() => {
    prisma = mockPrisma();
    emailQueue = mockEmailQueue();
    service = new CronService(prisma as never, emailQueue as never);
  });

  it('expires TRIAL subscriptions whose Trial.endsAt is in the past', async () => {
    prisma.subscription.updateMany.mockResolvedValue({ count: 3 });

    await service.expireTrials();

    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: { status: 'TRIAL', trial: { endsAt: { lt: expect.any(Date) } } },
      data: { status: 'EXPIRED' },
    });
  });

  it('only guards on status: TRIAL — never touches ACTIVE/CANCELLED subscriptions even with a past Trial.endsAt', async () => {
    await service.expireTrials();

    expect(prisma.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'TRIAL' }),
      }),
    );
  });

  it('does not send any email (J-7/J-1 reminders are Story 2.4)', async () => {
    await service.expireTrials();

    expect(emailQueue.sendEmail).not.toHaveBeenCalled();
  });

  it('logs the number of expired trials', async () => {
    prisma.subscription.updateMany.mockResolvedValue({ count: 2 });
    const logSpy = jest
      .spyOn(service['logger'], 'log')
      .mockImplementation(() => undefined);

    await service.expireTrials();

    expect(logSpy).toHaveBeenCalledWith('Expired 2 trials.');
  });
});

// ─── expireMandates ───────────────────────────────────────────────────────────

describe('CronService — expireMandates', () => {
  let service: CronService;
  let prisma: ReturnType<typeof mockPrisma>;
  let emailQueue: ReturnType<typeof mockEmailQueue>;

  beforeEach(() => {
    prisma = mockPrisma();
    emailQueue = mockEmailQueue();
    service = new CronService(prisma as never, emailQueue as never);
  });

  it('finds ACTIVE mandates with past endDate and expires them', async () => {
    const stubs = [{ id: 'm-1', propertyId: 'p-1', managerId: 'mgr-1' }];
    prisma.mandate.findMany.mockResolvedValue(stubs);

    await service.expireMandates();

    expect(prisma.mandate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'ACTIVE', deletedAt: null }),
      }),
    );
    expect(prisma.mandate.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['m-1'] } },
      data: { status: 'EXPIRED' },
    });
  });

  it('clears Property.managerId for each expired mandate', async () => {
    const stubs = [
      { id: 'm-1', propertyId: 'p-1', managerId: 'mgr-1' },
      { id: 'm-2', propertyId: 'p-2', managerId: 'mgr-2' },
    ];
    prisma.mandate.findMany.mockResolvedValue(stubs);

    await service.expireMandates();

    expect(prisma.property.updateMany).toHaveBeenCalledWith({
      where: { id: 'p-1', managerId: 'mgr-1' },
      data: { managerId: null },
    });
    expect(prisma.property.updateMany).toHaveBeenCalledWith({
      where: { id: 'p-2', managerId: 'mgr-2' },
      data: { managerId: null },
    });
  });

  it('logs the count and does not call updateMany when no mandates to expire', async () => {
    prisma.mandate.findMany.mockResolvedValue([]);
    const logSpy = jest
      .spyOn(service['logger'], 'log')
      .mockImplementation(() => undefined);

    await service.expireMandates();

    expect(logSpy).toHaveBeenCalledWith('Expired 0 mandates.');
    expect(prisma.mandate.updateMany).not.toHaveBeenCalled();
  });
});
