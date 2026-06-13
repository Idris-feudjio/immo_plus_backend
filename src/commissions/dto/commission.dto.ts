import { CommissionCategory, CommissionStatus } from '@prisma/client';

export class CreateCommissionDto {
  contractId!: string;
  mandateId?: string;
  agencyId?: string;
  type!: CommissionCategory;
  amountHT!: number;
  description?: string;
}

export class PayCommissionDto {
  paymentMethod!: string;
  reference?: string;
}

export class FilterCommissionsDto {
  status?: CommissionStatus;
  type?: CommissionCategory;
  agencyId?: string;
  contractId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}
