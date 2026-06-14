import type { AgencyMemberRole } from '@prisma/client';

export interface PublicAgencyProfile {
  id: string;
  name: string;
  address: string | null;
  phone: string;
  email: string;
  managedPropertiesCount: number;
}

export class CreateAgencyDto {
  name!: string;
  email!: string;
  phone!: string;
  address?: string;
  rccm?: string;
}

export class ListAgenciesDto {
  page?: number;
  limit?: number;
}

export class AddAgencyMemberDto {
  userId!: string;
  role?: AgencyMemberRole;
}
