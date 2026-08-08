import { Injectable } from '@nestjs/common';
import { differenceInDays } from 'date-fns';
import { SubscriptionStatus, PlanName } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface MySubscriptionSummary {
  status: SubscriptionStatus;
  planName: PlanName;
  trialDaysRemaining: number | null;
}

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  async getMySubscriptionSummary(
    userId: string,
  ): Promise<MySubscriptionSummary | null> {
    const membership = await this.prisma.agencyMember.findUnique({
      where: { userId },
    });

    const subscription = membership
      ? await this.prisma.subscription.findUnique({
          where: { agencyId: membership.agencyId },
          include: { plan: true, trial: true },
        })
      : await this.prisma.subscription.findUnique({
          where: { ownerId: userId },
          include: { plan: true, trial: true },
        });

    if (!subscription) return null;

    const trialDaysRemaining =
      subscription.status === SubscriptionStatus.TRIAL && subscription.trial
        ? Math.max(0, differenceInDays(subscription.trial.endsAt, new Date()))
        : null;

    return {
      status: subscription.status,
      planName: subscription.plan.name,
      trialDaysRemaining,
    };
  }
}
