import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type PlanLimitResource = 'properties' | 'users' | 'pdf';

export interface SubscriptionContext {
  subscriptionId: string;
  planId: string;
  agencyId: string | null;
  ownerId: string | null;
  limits: {
    maxProperties: number | null;
    maxUsers: number | null;
    maxPdfPerMonth: number | null;
  };
}

export interface LimitCheckResult {
  allowed: boolean;
  limit: number | null;
  current: number;
}

@Injectable()
export class PlanLimitService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveSubscriptionContext(
    userId: string,
  ): Promise<SubscriptionContext | null> {
    const membership = await this.prisma.agencyMember.findUnique({
      where: { userId },
    });

    const subscription = membership
      ? await this.prisma.subscription.findUnique({
          where: { agencyId: membership.agencyId },
          include: { plan: true },
        })
      : await this.prisma.subscription.findUnique({
          where: { ownerId: userId },
          include: { plan: true },
        });

    if (!subscription) return null;

    return {
      subscriptionId: subscription.id,
      planId: subscription.planId,
      agencyId: subscription.agencyId,
      ownerId: subscription.ownerId,
      limits: {
        maxProperties: subscription.plan.maxProperties,
        maxUsers: subscription.plan.maxUsers,
        maxPdfPerMonth: subscription.plan.maxPdfPerMonth,
      },
    };
  }

  async checkLimit(
    userId: string,
    resource: PlanLimitResource,
    count = 1,
  ): Promise<LimitCheckResult> {
    const ctx = await this.resolveSubscriptionContext(userId);
    // Fail-open: accounts created before this story have no Subscription yet.
    // Blocking them retroactively would be an unrequested service regression.
    if (!ctx) return { allowed: true, limit: null, current: 0 };

    if (resource === 'pdf') {
      // No per-month PDF usage tracking exists yet — stub until a story requires it.
      return { allowed: true, limit: ctx.limits.maxPdfPerMonth, current: 0 };
    }

    const limit =
      resource === 'properties'
        ? ctx.limits.maxProperties
        : ctx.limits.maxUsers;
    const current =
      resource === 'properties'
        ? await this.countProperties(ctx)
        : await this.countUsers(ctx);

    const allowed = limit === null || current + count <= limit;
    return { allowed, limit, current };
  }

  private async countProperties(ctx: SubscriptionContext): Promise<number> {
    if (!ctx.agencyId) {
      return this.prisma.property.count({
        where: { OR: [{ ownerId: ctx.ownerId! }, { managerId: ctx.ownerId! }] },
      });
    }

    const members = await this.prisma.agencyMember.findMany({
      where: { agencyId: ctx.agencyId },
    });
    const memberUserIds = members.map((m) => m.userId);
    return this.prisma.property.count({
      where: {
        OR: [
          { ownerId: { in: memberUserIds } },
          { managerId: { in: memberUserIds } },
        ],
      },
    });
  }

  private async countUsers(ctx: SubscriptionContext): Promise<number> {
    if (!ctx.agencyId) return 1;
    return this.prisma.agencyMember.count({
      where: { agencyId: ctx.agencyId },
    });
  }
}
