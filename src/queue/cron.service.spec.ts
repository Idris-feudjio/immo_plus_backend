import { CronService } from './cron.service';

// ─── Mock factories ───────────────────────────────────────────────────────────

function mockPrisma() {
  return {
    payment: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), findMany: jest.fn().mockResolvedValue([]) },
    contract: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    property: { update: jest.fn() },
    notification: { create: jest.fn().mockResolvedValue({}), createMany: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    paymentAlertConfig: { findMany: jest.fn().mockResolvedValue([]) },
    mandate: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
}

function mockEmailQueue() {
  return { sendEmail: jest.fn().mockResolvedValue(undefined) };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const OWNER = { id: 'owner-1', email: 'owner@test.cm', firstName: 'Marc', lastName: 'Dupont' };

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
      .mockResolvedValueOnce([PENDING_PAYMENT])  // pre-due query
      .mockResolvedValue([]);                      // late queries return empty

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
      .mockResolvedValueOnce([])              // pre-due: nothing
      .mockResolvedValueOnce([LATE_PAYMENT])  // daysAfterDue[0] = 1 day late
      .mockResolvedValue([]);                  // rest empty

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

  it('updates all ACTIVE mandates with past endDate to EXPIRED', async () => {
    prisma.mandate.updateMany.mockResolvedValue({ count: 3 });

    await service.expireMandates();

    expect(prisma.mandate.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'ACTIVE',
          endDate: { lt: expect.any(Date) },
          deletedAt: null,
        }),
        data: { status: 'EXPIRED' },
      }),
    );
  });

  it('logs the count of expired mandates', async () => {
    prisma.mandate.updateMany.mockResolvedValue({ count: 5 });
    const logSpy = jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);

    await service.expireMandates();

    expect(logSpy).toHaveBeenCalledWith('Expired 5 mandates.');
  });

  it('does nothing when no mandates are expired (count = 0)', async () => {
    prisma.mandate.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.expireMandates()).resolves.not.toThrow();
    expect(prisma.mandate.updateMany).toHaveBeenCalledTimes(1);
  });
});
