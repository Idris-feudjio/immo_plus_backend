import type { CommissionType, MandateStatus } from '@prisma/client';

export class CreateMandateDto {
  propertyId!: string;
  agencyId!: string;
  managerId!: string;
  startDate!: string;
  endDate?: string;
  commissionType?: CommissionType;
  commissionValue?: number;
  description?: string;
}

export class TerminateMandateDto {
  reason?: string;
}

export class ListMandatesDto {
  status?: MandateStatus;
  propertyId?: string;
  agencyId?: string;
  page?: number;
  limit?: number;
}
