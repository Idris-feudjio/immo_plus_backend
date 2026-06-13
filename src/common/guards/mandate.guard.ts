import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { MandateRepository } from '../../mandates/mandate.repository';

@Injectable()
export class MandateGuard implements CanActivate {
  constructor(private readonly mandateRepository: MandateRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user: { id: string; role: Role };
      params: Record<string, string>;
      body: Record<string, string>;
    }>();

    const { user, params, body } = request;

    if (user.role !== Role.MANAGER) return true;

    const propertyId = params?.propertyId ?? body?.propertyId;
    if (!propertyId) {
      throw new ForbiddenException('MISSING_PROPERTY_ID');
    }

    const mandate = await this.mandateRepository.findActiveByManager(
      user.id,
      propertyId,
    );
    if (!mandate) {
      throw new ForbiddenException('NO_ACTIVE_MANDATE');
    }

    return true;
  }
}
