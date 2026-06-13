import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { MandateGuard } from './mandate.guard';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeContext(opts: {
  role: string;
  userId?: string;
  params?: Record<string, string>;
  body?: Record<string, string>;
}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        user: { id: opts.userId ?? 'user-1', role: opts.role },
        params: opts.params ?? {},
        body: opts.body ?? {},
      }),
    }),
  } as unknown as ExecutionContext;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MandateGuard', () => {
  let guard: MandateGuard;
  let mockRepo: { findActiveByManager: jest.Mock };

  beforeEach(() => {
    mockRepo = { findActiveByManager: jest.fn() };
    guard = new MandateGuard(mockRepo as never);
  });

  describe('non-MANAGER roles bypass', () => {
    for (const role of ['OWNER', 'ADMIN', 'TENANT', 'VISITOR']) {
      it(`${role} passes without querying DB`, async () => {
        const result = await guard.canActivate(makeContext({ role }));
        expect(result).toBe(true);
        expect(mockRepo.findActiveByManager).not.toHaveBeenCalled();
      });
    }
  });

  describe('MANAGER role', () => {
    it('throws ForbiddenException when no propertyId in params or body', async () => {
      await expect(
        guard.canActivate(makeContext({ role: 'MANAGER', params: {}, body: {} })),
      ).rejects.toThrow(ForbiddenException);
      expect(mockRepo.findActiveByManager).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException(NO_ACTIVE_MANDATE) when no active mandate', async () => {
      mockRepo.findActiveByManager.mockResolvedValue(null);

      await expect(
        guard.canActivate(
          makeContext({ role: 'MANAGER', params: { propertyId: 'prop-1' } }),
        ),
      ).rejects.toThrow('NO_ACTIVE_MANDATE');
    });

    it('passes when manager has an active mandate (propertyId from params)', async () => {
      mockRepo.findActiveByManager.mockResolvedValue({ id: 'mandate-1' });

      const result = await guard.canActivate(
        makeContext({ role: 'MANAGER', params: { propertyId: 'prop-1' } }),
      );

      expect(result).toBe(true);
      expect(mockRepo.findActiveByManager).toHaveBeenCalledWith('user-1', 'prop-1');
    });

    it('resolves propertyId from body when not in params', async () => {
      mockRepo.findActiveByManager.mockResolvedValue({ id: 'mandate-1' });

      const result = await guard.canActivate(
        makeContext({ role: 'MANAGER', params: {}, body: { propertyId: 'prop-2' } }),
      );

      expect(result).toBe(true);
      expect(mockRepo.findActiveByManager).toHaveBeenCalledWith('user-1', 'prop-2');
    });

    it('prefers params.propertyId over body.propertyId', async () => {
      mockRepo.findActiveByManager.mockResolvedValue({ id: 'mandate-1' });

      await guard.canActivate(
        makeContext({
          role: 'MANAGER',
          params: { propertyId: 'from-params' },
          body: { propertyId: 'from-body' },
        }),
      );

      expect(mockRepo.findActiveByManager).toHaveBeenCalledWith(
        'user-1',
        'from-params',
      );
    });
  });
});
