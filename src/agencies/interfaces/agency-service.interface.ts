import type { Agency, AgencyMember } from '@prisma/client';
import type { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import type { AddAgencyMemberDto, CreateAgencyDto, ListAgenciesDto } from '../dto/agency.dto';

export const AGENCY_SERVICE = 'IAgencyService';

export interface PublicAgencyProfile {
  id: string;
  name: string;
  address: string | null;
  phone: string;
  email: string;
  managedPropertiesCount: number;
}

export interface IAgencyService {
  create(dto: CreateAgencyDto): Promise<Agency>;
  suspend(id: string): Promise<Agency>;
  list(query: ListAgenciesDto): Promise<PaginatedResult<Agency & { _count: { members: number } }>>;
  addMember(agencyId: string, requesterId: string, requesterRole: string, dto: AddAgencyMemberDto): Promise<AgencyMember>;
  removeMember(agencyId: string, memberId: string): Promise<void>;
  getPublicProfile(id: string): Promise<PublicAgencyProfile>;
}
